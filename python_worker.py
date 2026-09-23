#!/usr/bin/env python3
"""One-request JSON worker for the Node/Python local bridge."""

import json
import sys
from datetime import timedelta
from pathlib import Path

from services import FollowService, LoginService, PostService, RegistrationService, TimelineService
from security import hashPassword
from storage import DataStore, SelfFollowError, UsernameAlreadyExistsError

VERSION = 1
MAX_LINE = 1024 * 1024
OPERATIONS = {
    "health", "register", "login", "current_user", "user_by_username", "get_session", "list_users", "follow",
    "create_post", "timeline", "logout", "create_session", "get_followees",
    "follow_exists", "bootstrap",
}


def envelope(ok, result=None, code=None, message=None):
    value = {"version": VERSION, "ok": ok}
    if ok:
        value["result"] = result if result is not None else {}
    else:
        value["error"] = {"code": code, "message": message}
    return value


def fail(code, message):
    return envelope(False, code=code, message=message)


def validate(request):
    if not isinstance(request, dict) or request.get("version") != VERSION:
        return fail("INVALID_REQUEST", "invalid request")
    if request.get("operation") not in OPERATIONS:
        return fail("UNKNOWN_OPERATION", "unknown operation")
    if not isinstance(request.get("payload"), dict):
        return fail("INVALID_REQUEST", "invalid request")
    db_path = request.get("db_path")
    if not isinstance(db_path, str) or not Path(db_path).is_absolute():
        return fail("INVALID_REQUEST", "invalid request")
    return None


def dispatch(request):
    invalid = validate(request)
    if invalid:
        return invalid
    operation = request["operation"]
    payload = request["payload"]
    try:
        with DataStore(request["db_path"]) as store:
            if operation == "health":
                store.getUserById(-1)
                return envelope(True, {"healthy": True})
            if operation == "register":
                return envelope(True, RegistrationService(store).register(payload["username"], payload["password"]))
            if operation == "login":
                return envelope(True, LoginService(store).login(payload["username"], payload["password"]))
            if operation == "current_user":
                if "user_id" in payload:
                    user = store.getUserById(payload["user_id"])
                else:
                    session = store.getSession(payload.get("token", ""))
                    user = store.getUserById(session["user_id"]) if session else None
                return envelope(True, {"user": {"id": user["id"], "username": user["username"]} if user else None})
            if operation == "user_by_username":
                user = store.getUserByUsername(payload["username"])
                return envelope(True, {"user": {"id": user["id"], "username": user["username"]} if user else None})
            if operation == "get_session":
                return envelope(True, {"session": store.getSession(payload.get("token", ""))})
            if operation == "list_users":
                return envelope(True, {"users": store.listUsers()})
            if operation == "follow":
                FollowService(store).follow(payload["follower_id"], payload["followee_id"])
                return envelope(True, {"created": True})
            if operation == "create_post":
                return envelope(True, PostService(store).createPost(payload["author_id"], payload["content"]))
            if operation == "timeline":
                return envelope(True, {"posts": TimelineService(store).getTimeline(payload["user_id"])})
            if operation == "logout":
                store.destroySession(payload.get("token", ""))
                return envelope(True, {"logged_out": True})
            if operation == "create_session":
                return envelope(True, store.createSession(payload["user_id"]))
            if operation == "get_followees":
                return envelope(True, {"followee_ids": store.getFolloweeIds(payload["user_id"])})
            if operation == "follow_exists":
                return envelope(True, {"exists": store.followExists(payload["follower_id"], payload["followee_id"])})
            if operation == "bootstrap":
                bootstrap(store)
                return envelope(True, {"bootstrapped": True})
    except (KeyError, TypeError, ValueError):
        return fail("INVALID_REQUEST", "invalid request")
    except (UsernameAlreadyExistsError, SelfFollowError):
        return fail("SERVICE_ERROR", "service request failed")
    except Exception:
        return fail("STORAGE_ERROR", "storage unavailable")
    return fail("UNKNOWN_OPERATION", "unknown operation")


def bootstrap(store):
    """Create durable demo records without making Node own business state."""
    users = {}
    for username, password in (
        ("bob", "right-password"),
        ("carol", "carol-password"),
        ("timeline-viewer", "timeline-viewer-password"),
    ):
        user = store.getUserByUsername(username)
        if user is None:
            creds = hashPassword(password)
            user_id = store.createUser(username, creds["hash"], creds["salt"])
            user = store.getUserById(user_id)
        users[username] = user["id"]

    for followee in ("bob", "carol"):
        if not store.followExists(users["timeline-viewer"], users[followee]):
            store.addFollow(users["timeline-viewer"], users[followee])
    if not store.getPostsByAuthorIds({users["bob"]}):
        store.createPost(users["bob"], "刚跑完五公里，状态不错")
        store.createPost(users["bob"], "早起的鸟儿有虫吃")
    if not store.getPostsByAuthorIds({users["carol"]}):
        store.createPost(users["carol"], "读完了《设计数据密集型应用》第九章")
        store.createPost(users["carol"], "午饭试试新开的那家面馆")
    if store.getSession("seed-token-1") is None:
        store._insertSession("seed-token-1", users["timeline-viewer"], timedelta(days=7))


def main():
    line = sys.stdin.readline(MAX_LINE + 1)
    if not line or len(line.encode("utf-8")) > MAX_LINE:
        response = fail("INVALID_REQUEST", "invalid request")
    else:
        try:
            response = dispatch(json.loads(line))
        except Exception:
            response = fail("INVALID_REQUEST", "invalid request")
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
