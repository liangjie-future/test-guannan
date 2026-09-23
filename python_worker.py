#!/usr/bin/env python3
"""One-request JSON worker for the Node/Python local bridge."""

import json
import sys
from pathlib import Path

from services import FollowService, LoginService, PostService, RegistrationService, TimelineService
from storage import DataStore, SelfFollowError, UsernameAlreadyExistsError

VERSION = 1
MAX_LINE = 1024 * 1024
OPERATIONS = {
    "health", "register", "login", "current_user", "list_users", "follow",
    "create_post", "timeline", "logout",
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
    except (KeyError, TypeError, ValueError):
        return fail("INVALID_REQUEST", "invalid request")
    except (UsernameAlreadyExistsError, SelfFollowError):
        return fail("SERVICE_ERROR", "service request failed")
    except Exception:
        return fail("STORAGE_ERROR", "storage unavailable")
    return fail("UNKNOWN_OPERATION", "unknown operation")


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
