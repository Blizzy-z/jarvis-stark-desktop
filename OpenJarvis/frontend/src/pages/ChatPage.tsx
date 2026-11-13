import { useCloud } from '../lib/cloud';
import { useMobile } from '../hooks/useMobile';
import { ChatArea } from '../components/Chat/ChatArea';
import { SystemPanel } from '../components/Chat/SystemPanel';
import { useAppStore } from '../lib/store';

export function ChatPage() {
  const mobile = useMobile();
  const standalone = useCloud(s=>s.standalone);
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0">
        <ChatArea />
      </div>
      {systemPanelOpen && !mobile && !standalone && <SystemPanel />}
    </div>
  );
}
