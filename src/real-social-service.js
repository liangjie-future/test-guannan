/**
 * Production-facing bridge adapters for authentication and social actions.
 * The adapter deliberately keeps the Python session token at the boundary.
 */
import { PythonBridgeError } from './python-bridge.js';

function call(bridge, operation, payload) {
  try {
    return bridge.request(operation, payload);
  } catch (error) {
    if (error instanceof PythonBridgeError) error.statusCode = 503;
    throw error;
  }
}

export function createRealSocialService(bridge) {
  return {
    register: (username, password) => call(bridge, 'register', { username, password }),
    login: (username, password) => call(bridge, 'login', { username, password }),
    currentUser: (sessionToken) => call(bridge, 'current_user', { session_token: sessionToken }).user ?? null,
    listUsers: (sessionToken) => call(bridge, 'list_users', { session_token: sessionToken }),
    follow: (sessionToken, followeeId) => call(bridge, 'follow', { session_token: sessionToken, followee_id: followeeId }),
    createPost: (sessionToken, content) => call(bridge, 'create_post', { session_token: sessionToken, content }),
    getTimeline: (sessionToken) => call(bridge, 'timeline', { session_token: sessionToken }).posts,
    logout: (sessionToken) => call(bridge, 'logout', { session_token: sessionToken }),
  };
}
