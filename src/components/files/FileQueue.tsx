import { AnimatePresence } from 'framer-motion';
import { useQueueStore, selectOrder } from '../../store/queueStore';
import { FileCard } from './FileCard';

export function FileQueue() {
  const order = useQueueStore(selectOrder);
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
