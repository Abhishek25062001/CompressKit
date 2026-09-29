// Rewrites the BiRefNet graph so ONNX Runtime can run all of it on the graphics card (WebGPU).
// Every change gives exactly the same result as the original (checked bit for bit on the CPU):
//
// - A Concat of more than MAX_FAN inputs becomes a tree of smaller Concats, and a Split with more
//   than MAX_FAN outputs becomes a tree of smaller Splits. WebGPU gives each shader 8 storage buffers
//   by default, and the model's image-to-patches step joins up to 1024 pieces in one node.
// - Sum becomes a chain of Adds. The WebGPU backend has no Sum, so ONNX Runtime ran those nodes on
//   the processor, copying large feature maps into WebAssembly memory until it ran out.
import onnxProto from 'onnx-proto';

const { onnx } = onnxProto;

/** Largest Concat input count and Split output count kept in one node (one buffer is the other side). */
const MAX_FAN = 6;

/** Bump when the rewrite changes, so `npm run model` patches the model again. */
export const PATCH_VERSION = 1;

const toNumber = (v) => (typeof v === 'object' && v !== null ? v.toNumber() : Number(v));

function int64Values(tensor) {
  if (tensor.int64Data?.length) return tensor.int64Data.map(toNumber);
  const raw = Buffer.from(tensor.rawData);
  const out = [];
  for (let i = 0; i < raw.length; i += 8) out.push(Number(raw.readBigInt64LE(i)));
  return out;
}

function int64Tensor(name, values) {
  const raw = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => raw.writeBigInt64LE(BigInt(v), i * 8));
  return onnx.TensorProto.create({ name, dims: [values.length], dataType: onnx.TensorProto.DataType.INT64, rawData: raw });
}

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** @param {Uint8Array} bytes the original model @returns {Uint8Array} the rewritten model */
export function patchForWebGpu(bytes) {
  const model = onnx.ModelProto.decode(bytes);
  const graph = model.graph;

  const constants = new Map();
  for (const t of graph.initializer) constants.set(t.name, t);
  for (const n of graph.node) {
    const value = n.opType === 'Constant' && n.attribute.find((a) => a.name === 'value');
    if (value) constants.set(n.output[0], value.t);
  }

  let uid = 0;
  const fresh = (base) => `${base}__webgpu${uid++}`;
  const nodes = [];
  const initializers = [];

  // Joins groups of inputs level by level until at most MAX_FAN remain; returns those.
  function concatTree(inputs, axis, name) {
    let level = inputs;
    while (level.length > MAX_FAN) {
      level = chunk(level, MAX_FAN).map((group) => {
        if (group.length === 1) return group[0];
        const output = fresh(name);
        nodes.push(onnx.NodeProto.create({ name: fresh(name), opType: 'Concat', input: group, output: [output], attribute: [axis] }));
        return output;
      });
    }
    return level;
  }

  // Splits into groups of outputs first, then splits each group, so no node has more than MAX_FAN outputs.
  function splitTree(input, sizes, outputs, axis, name) {
    if (outputs.length <= MAX_FAN) {
      const sizesName = fresh(`${name}_sizes`);
      initializers.push(int64Tensor(sizesName, sizes));
      nodes.push(onnx.NodeProto.create({ name: fresh(name), opType: 'Split', input: [input, sizesName], output: outputs, attribute: [axis] }));
      return;
    }
    const groups = chunk(
      outputs.map((output, i) => ({ output, size: sizes[i] })),
      Math.ceil(outputs.length / MAX_FAN),
    );
    const groupOutputs = groups.map((g) => (g.length === 1 ? g[0].output : fresh(name)));
    splitTree(
      input,
      groups.map((g) => g.reduce((sum, part) => sum + part.size, 0)),
      groupOutputs,
      axis,
      name,
    );
    groups.forEach((g, i) => {
      if (g.length > 1) splitTree(groupOutputs[i], g.map((part) => part.size), g.map((part) => part.output), axis, name);
    });
  }

  for (const node of graph.node) {
    if (node.opType === 'Concat' && node.input.length > MAX_FAN) {
      node.input = concatTree(node.input, node.attribute.find((a) => a.name === 'axis'), node.name);
      nodes.push(node);
    } else if (node.opType === 'Split' && node.output.length > MAX_FAN) {
      const sizes = constants.get(node.input[1]);
      if (!sizes) throw new Error(`Split ${node.name} has no constant sizes`);
      const values = int64Values(sizes);
      if (values.length !== node.output.length) throw new Error(`Split ${node.name}: ${values.length} sizes for ${node.output.length} outputs`);
      splitTree(node.input[0], values, node.output, node.attribute.find((a) => a.name === 'axis'), node.name);
    } else if (node.opType === 'Sum' && node.input.length === 1) {
      nodes.push(onnx.NodeProto.create({ name: node.name, opType: 'Identity', input: node.input, output: node.output }));
    } else if (node.opType === 'Sum') {
      let total = node.input[0];
      node.input.slice(1).forEach((addend, i) => {
        const last = i === node.input.length - 2;
        const output = last ? node.output[0] : fresh(node.name);
        nodes.push(onnx.NodeProto.create({ name: last ? node.name : fresh(node.name), opType: 'Add', input: [total, addend], output: [output] }));
        total = output;
      });
    } else {
      nodes.push(node);
    }
  }

  graph.node = nodes;
  graph.initializer.push(...initializers);

  for (const n of graph.node) {
    if ((n.opType === 'Concat' && n.input.length > MAX_FAN) || (n.opType === 'Split' && n.output.length > MAX_FAN) || n.opType === 'Sum') {
      throw new Error(`patch incomplete: ${n.opType} ${n.name}`);
    }
  }
  return onnx.ModelProto.encode(model).finish();
}
