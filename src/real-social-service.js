/**
 * Production-facing bridge adapters for authentication and social actions.
 * The adapter deliberately keeps the Python session token at the boundary.
 */
export function createRealSocialService(bridge) {
  return {
    register: (username, password) => bridge.request('register', { username, password }),
    login: (username, password) => bridge.request('login', { username, password }),
    currentUser: (sessionToken) => bridge.request('current_user', { session_token: sessionToken }).user ?? null,
    listUsers: (sessionToken) => bridge.request('list_users', { session_token: sessionToken }),
    follow: (sessionToken, followeeId) => bridge.request('follow', { session_token: sessionToken, followee_id: followeeId }),
    logout: (sessionToken) => bridge.request('logout', { session_token: sessionToken }),
  };
}
