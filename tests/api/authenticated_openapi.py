#!/usr/bin/env python3
"""Build and preflight an OpenAPI subset backed by disposable API fixtures."""

import copy
import json
import os
import sys
import urllib.error
import urllib.request

import yaml


OPERATIONS = {
    "currentUser", "listUsers", "listBackups", "listImages", "listMyImages",
    "listSharedImages", "listMediaGroups", "exploreQuizzes", "listQuizzes",
    "getQuiz", "listQuizQuestions", "listQuizAttempts", "getQuizAttempt",
    "getImage", "exportQuizZip", "startAttemptQuestion", "saveQuestionTime",
    "saveQuizAnswer",
}
BODIES = {
    "saveQuestionTime": {"time_spent_ms": 1250},
    "saveQuizAnswer": {"answer": {"viewed": True}},
}


def main():
    source, destination = sys.argv[1:3]
    ids = {name: int(os.environ[f"OPENAPI_{name.upper()}"]) for name in
           ("userId", "quizId", "attemptId", "questionId", "imageId")}
    origin = os.environ["API_TEST_BASE_URL"].rstrip("/")
    cookie = os.environ["OPENAPI_AUTH_COOKIE"]
    with open(source, encoding="utf-8") as stream:
        document = yaml.safe_load(stream)

    selected = {}
    found = set()
    for path, item in document["paths"].items():
        operations = {}
        for method, operation in item.items():
            if not isinstance(operation, dict) or operation.get("operationId") not in OPERATIONS:
                continue
            operation = copy.deepcopy(operation)
            name = operation["operationId"]
            found.add(name)
            if name in BODIES:
                operation["requestBody"]["content"]["application/json"]["schema"] = {
                    "const": BODIES[name]
                }
                operation["requestBody"]["content"]["application/json"]["example"] = BODIES[name]
            operations[method] = operation
        if operations:
            entry = {"parameters": copy.deepcopy(item.get("parameters", [])), **operations}
            for parameter in entry["parameters"]:
                if parameter["name"] in ids:
                    parameter["schema"] = {"type": "integer", "const": ids[parameter["name"]]}
            selected[path] = entry

    if found != OPERATIONS:
        raise SystemExit(f"Authenticated operation selection is stale: {sorted(OPERATIONS - found)}")
    document["paths"] = selected
    with open(destination, "w", encoding="utf-8") as stream:
        yaml.safe_dump(document, stream, sort_keys=False, allow_unicode=True)

    # A documented 401 or 404 would pass contract checks. Verify that every
    # selected operation actually reaches its successful response first.
    for path, item in selected.items():
        actual = path
        for name, value in ids.items():
            actual = actual.replace("{" + name + "}", str(value))
        for method, operation in item.items():
            if method == "parameters":
                continue
            body = BODIES.get(operation["operationId"])
            data = None if body is None else json.dumps(body).encode()
            request = urllib.request.Request(
                origin + "/api" + actual, data=data, method=method.upper(),
                headers={"Cookie": f"softerr_session={cookie}",
                         **({"Content-Type": "application/json"} if body else {})},
            )
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    status = response.status
                    response.read()
            except urllib.error.HTTPError as error:
                status = error.code
                error.close()
            if status != 200:
                raise SystemExit(f"Authenticated preflight {operation['operationId']} returned HTTP {status}")
    print(f"Authenticated preflight: {len(OPERATIONS)} operations returned HTTP 200.")


if __name__ == "__main__":
    main()
