/**
 * FP-010 用户 / 关注数据适配层（任务卡 §3.2 依赖契约的 Node 侧消费端）。
 *
 * FP-001（listUsers 等持久化原语）与 FP-011（follow 规则消费的存取原语）
 * 的产出是 Python SQLite 层，Node Web 进程无法进程内调用；此处按同一契约
 * 提供内存默认实现（§6 Mock 策略），内置验证用种子数据：
 * 用户 alice(1) / bob(2) / carol(3)，关注边 alice→bob。
 * 持久化桥接属集成点：替换注入的 store 即可，页面逻辑零改动。
 */

const SEED_USERS = [
  { id: 1, username: 'alice', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 2, username: 'bob', created_at: '2026-01-02T00:00:00.000Z' },
  { id: 3, username: 'carol', created_at: '2026-01-03T00:00:00.000Z' },
];

const SEED_FOLLOW_EDGES = [[1, 2]];

/**
 * 内存版用户 / 关注存取原语（契约同 FP-001 §3.2）：
 * getUserById / listUsers / addFollow / followExists / getFolloweeIds。
 * users 为 Map<id, user>、followEdges 为 Map<followerId, Set<followeeId>>，
 * 可注入供测试替换种子。
 */
export function createMemorySocialStore({ users = null, followEdges = null } = {}) {
  const userTable = users ?? new Map(SEED_USERS.map((user) => [user.id, { ...user }]));
  const edgeTable =
    followEdges ?? SEED_FOLLOW_EDGES.reduce((table, [follower, followee]) => {
      table.set(follower, new Set([followee]));
      return table;
    }, new Map());

  return {
    getUserById(id) {
      const user = userTable.get(id);
      return user === undefined ? null : { ...user };
    },

    /** 全量用户（含调用者自身），按 id 升序，返回副本。 */
    listUsers() {
      return [...userTable.values()]
        .map((user) => ({ ...user }))
        .sort((a, b) => a.id - b.id);
    },

    /** 建立单向边 follower→followee；重复写天然幂等（Set 去重）。 */
    addFollow(followerId, followeeId) {
      const followees = edgeTable.get(followerId) ?? new Set();
      followees.add(followeeId);
      edgeTable.set(followerId, followees);
    },

    followExists(followerId, followeeId) {
      return edgeTable.get(followerId)?.has(followeeId) ?? false;
    },

    getFolloweeIds(userId) {
      return [...(edgeTable.get(userId) ?? [])].sort((a, b) => a - b);
    },
  };
}
