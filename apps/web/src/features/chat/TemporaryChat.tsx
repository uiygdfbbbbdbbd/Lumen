import { ChatPage } from './ChatPage.js';

/** A chat that starts in temporary (incognito) mode: no history, no memory, auto-deleted. */
export function TemporaryChat() {
  return <ChatPage key="temporary" incognitoDefault />;
}
