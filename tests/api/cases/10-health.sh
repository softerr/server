#!/usr/bin/env bash

test_api_health_get() {
  api_request "GET" "/api/"
  assert_status "200" || return 1
  assert_json_value '.status' 'ok' || return 1
  assert_json_value '.message' 'API is ready' || return 1
}

test_api_health_method_not_allowed() {
  api_request "POST" "/api/" '{}'
  assert_status "405" || return 1
  assert_json_value '.error' 'Method not allowed' || return 1
}

test_api_php_entrypoints_are_internal() {
  local entrypoint
  for entrypoint in index auth quiz media; do
    api_request GET "/api/${entrypoint}.php"
    assert_status 404 || return 1
  done
}

register_test_case test_api_health_get
register_test_case test_api_health_method_not_allowed
register_test_case test_api_php_entrypoints_are_internal
