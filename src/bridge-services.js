import { PythonBridgeError } from './python-bridge.js';

function call(bridge, operation, payload) {
  try {
    return bridge.request(operation, payload);
  } catch (error) {
    if (error instanceof PythonBridgeError) error.statusCode = 503;
    throw error;
  }
}

export function createBridgeStore(bridge) {
  return {
    getUserByUsername(username) {
      return call(bridge, 'user_by_username', { username }).user ?? null;
    },
    getUserById(userId) {
      return call(bridge, 'current_user', { user_id: userId }).user ?? null;
    },
    listUsers() {
      return call(bridge, 'list_users').users;
    },
    createSession(userId) {
      return call(bridge, 'create_session', { user_id: userId });
    },
    getSession(token) {
      return call(bridge, 'get_session', { token }).session;
    },
    destroySession(token) {
      call(bridge, 'logout', { token });
    },
    getFolloweeIds(userId) {
      return call(bridge, 'get_followees', { user_id: userId }).followee_ids;
    },
    followExists(followerId, followeeId) {
      return call(bridge, 'follow_exists', { follower_id: followerId, followee_id: followeeId }).exists;
    },
    addFollow(followerId, followeeId) {
      call(bridge, 'follow', { follower_id: followerId, followee_id: followeeId });
    },
  };
}

export function createBridgeRegisterService(bridge) {
  return {
    register(username, password) {
      return call(bridge, 'register', { username, password });
    },
  };
}

export function createBridgeLoginService(bridge) {
  return (username, password) => call(bridge, 'login', { username, password });
}

export function createBridgePostService(bridge) {
  return (authorId, content) => call(bridge, 'create_post', { author_id: authorId, content });
}

export function createBridgeTimelineService(bridge) {
  return (userId) => call(bridge, 'timeline', { user_id: userId }).posts;
}

export function createBridgeBootstrap(bridge) {
  return () => call(bridge, 'bootstrap');
}
