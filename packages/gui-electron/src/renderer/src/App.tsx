import React, { useState, KeyboardEvent } from 'react'

export default function App(): React.JSX.Element {
    const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
        { role: 'assistant', content: 'Type a message below to get started. Notice how the IME candidates now perfectly follow your cursor within the textarea!' }
    ])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSend = async () => {
        if (!input.trim() || loading) return;

        // Simulate current workspace dir for the skeleton
        const currentDir = '/Users/wangxinglin/Desktop/code/Xqoder';
        const userPrompt = input;

        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userPrompt }])

        setLoading(true);
        try {
            const response = await window.api.chat(currentDir, userPrompt);
            setMessages(prev => [...prev, { role: 'assistant', content: response }])
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }])
        } finally {
            setLoading(false);
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {messages.map((msg, idx) => (
                    <div key={idx} style={{ marginBottom: '16px', clear: 'both' }}>
                        <div style={{
                            float: msg.role === 'user' ? 'right' : 'left',
                            background: msg.role === 'user' ? '#0b93f6' : '#2d2d2d',
                            color: '#fff',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            maxWidth: '70%',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap'
                        }}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {loading && <div style={{ clear: 'both', float: 'left', color: '#888' }}>Thinking...</div>}
            </div>

            <div style={{ padding: '20px', background: '#252526', borderTop: '1px solid #333' }}>
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message... IME candidates will follow the cursor here smoothly."
                    style={{
                        width: '100%',
                        height: '80px',
                        background: '#1e1e1e',
                        color: '#fff',
                        border: '1px solid #3c3c3c',
                        borderRadius: '4px',
                        padding: '10px',
                        fontSize: '14px',
                        resize: 'none',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                        outline: 'none'
                    }}
                />
                <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSend}
                        disabled={loading || !input.trim()}
                        style={{
                            padding: '8px 16px',
                            background: loading || !input.trim() ? '#555' : '#0b93f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer'
                        }}
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    )
}
