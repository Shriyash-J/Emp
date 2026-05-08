import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../services/api';

const QUICK_ACTIONS = [
  'My Attendance',
  'My Leave Balance',
  'My Tasks',
  'My Payroll',
  'How to apply leave',
  'How to check in',
  'Holidays',
  'Help',
];

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { type: 'bot', text: "Hello! I'm the **WorkNet Assistant**. I can help with attendance, leaves, payroll, tasks, and company policies.\n\nType **help** to see all options, or tap a quick action below." }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async (overrideMsg) => {
    const msg = (overrideMsg || input).trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { type: 'user', text: msg }]);
    setLoading(true);
    try {
      const { data } = await sendChatMessage(msg);
      setMessages(prev => [...prev, { type: 'bot', text: data.response }]);
    } catch {
      setMessages(prev => [...prev, { type: 'bot', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (text) => text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
    .replace(/^- /gm, '&bull; ');

  return (
    <div className="chatbot-container">
      {isOpen && (
        <div className="chatbot-window">
          <div className="chatbot-header">
            <h3>WorkNet Assistant</h3>
            <button className="chatbot-close" onClick={() => setIsOpen(false)}>✕</button>
          </div>
          <div className="chatbot-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.type}`} dangerouslySetInnerHTML={{ __html: fmt(m.text) }} />
            ))}
            {loading && (
              <div className="chat-msg bot">
                <span className="chat-typing">
                  <span className="chat-dot"></span>
                  <span className="chat-dot"></span>
                  <span className="chat-dot"></span>
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick action chips */}
          {messages.length <= 2 && !loading && (
            <div className="chatbot-chips">
              {QUICK_ACTIONS.map((action) => (
                <button key={action} className="chatbot-chip" onClick={() => handleSend(action)}>
                  {action}
                </button>
              ))}
            </div>
          )}

          <div className="chatbot-input">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about attendance, leaves, payroll..."
              disabled={loading}
            />
            <button onClick={() => handleSend()} disabled={loading}>&#10148;</button>
          </div>
        </div>
      )}
      <button className="chatbot-toggle" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '💬'}
      </button>
    </div>
  );
}
