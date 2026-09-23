import { AnimatePresence } from 'framer-motion';
import { useTool } from '../../features/tools';
import { selectOrder } from '../../store/queueStore';
import { FileCard } from './FileCard';

export function FileQueue() {
  const { useQueue } = useTool();
  const order = useQueue(selectOrder);
  return (
    <ul aria-label="Files" className="space-y-3">
      <AnimatePresence initial={false}>
        {order.map((id) => (
          <FileCard key={id} id={id} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
