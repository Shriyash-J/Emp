import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getContacts, getConversation, sendMessage } from '../services/api';

export default function MessagingPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);

  // Load contacts
  useEffect(() => {
    getContacts()
      .then(({ data }) => { setContacts(data); setLoadingContacts(false); })
      .catch(() => setLoadingContacts(false));
  }, []);

  // Load conversation when contact selected
  const loadMessages = useCallback((contactId) => {
    if (!contactId) return;
    getConversation(contactId)
      .then(({ data }) => {
        setMessages(data.messages || []);
        // Update unread count in contacts list
        setContacts(prev => prev.map(c =>
          c.id === contactId ? { ...c, unread_count: 0 } : c
        ));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedContact) return;
    setLoadingMessages(true);
    loadMessages(selectedContact.id);
    setLoadingMessages(false);

    // Poll for new messages every 5 seconds
    pollRef.current = setInterval(() => loadMessages(selectedContact.id), 5000);
    return () => clearInterval(pollRef.current);
  }, [selectedContact, loadMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedContact || sending) return;
    setSending(true);
    try {
      const { data } = await sendMessage({
        receiver_id: selectedContact.id,
        message: newMessage.trim(),
      });
      setMessages(prev => [...prev, data]);
      setNewMessage('');
      // Update last message in contacts
      setContacts(prev => prev.map(c =>
        c.id === selectedContact.id
          ? { ...c, last_message: data.message.slice(0, 60), last_message_time: data.timestamp }
          : c
      ));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.department?.toLowerCase().includes(search.toLowerCase())
  );

  const formatTime = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="messaging-container">
      {/* Left Panel: Contact List */}
      <div className="messaging-sidebar">
        <div className="messaging-sidebar-header">
          <h2>Messages</h2>
          <input
            type="text"
            className="messaging-search"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="messaging-contact-list">
          {loadingContacts ? (
            <p className="messaging-empty">Loading contacts...</p>
          ) : filteredContacts.length === 0 ? (
            <p className="messaging-empty">No contacts found</p>
          ) : (
            filteredContacts.map(contact => (
              <div
                key={contact.id}
                className={`messaging-contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                onClick={() => setSelectedContact(contact)}
              >
                <div className="messaging-avatar">{contact.name.charAt(0)}</div>
                <div className="messaging-contact-info">
                  <div className="messaging-contact-top">
                    <strong className="messaging-contact-name">{contact.name}</strong>
                    {contact.last_message_time && (
                      <span className="messaging-contact-time">{formatTime(contact.last_message_time)}</span>
                    )}
                  </div>
                  <div className="messaging-contact-bottom">
                    <span className="messaging-contact-preview">
                      {contact.last_message || `${contact.department} - ${contact.position}`}
                    </span>
                    {contact.unread_count > 0 && (
                      <span className="messaging-unread-badge">{contact.unread_count}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Chat Window */}
      <div className="messaging-chat">
        {!selectedContact ? (
          <div className="messaging-no-chat">
            <div className="messaging-no-chat-icon">💬</div>
            <h3>Select a conversation</h3>
            <p>Choose an employee from the list to start chatting</p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="messaging-chat-header">
              <div className="messaging-avatar">{selectedContact.name.charAt(0)}</div>
              <div>
                <strong>{selectedContact.name}</strong>
                <span className="messaging-chat-role">
                  {selectedContact.department} &middot; {selectedContact.position || selectedContact.role}
                </span>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="messaging-chat-body">
              {loadingMessages ? (
                <p className="messaging-empty">Loading messages...</p>
              ) : messages.length === 0 ? (
                <div className="messaging-no-messages">
                  <p>No messages yet. Say hello!</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.sender_id === user?.id;
                  return (
                    <div key={msg.id} className={`messaging-bubble-row ${isMine ? 'sent' : 'received'}`}>
                      <div className={`messaging-bubble ${isMine ? 'sent' : 'received'}`}>
                        <p className="messaging-bubble-text">{msg.message}</p>
                        <span className="messaging-bubble-time">
                          {formatTime(msg.timestamp)}
                          {isMine && (
                            <span className="messaging-read-status">
                              {msg.is_read ? ' \u2713\u2713' : ' \u2713'}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="messaging-chat-input">
              <textarea
                className="messaging-input-field"
                placeholder="Type a message..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                className="messaging-send-btn"
                onClick={handleSend}
                disabled={!newMessage.trim() || sending}
              >
                {sending ? '...' : '➤'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
