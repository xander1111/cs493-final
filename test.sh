#!/bin/bash
# Tarpaulin API test script
# Requires: curl, jq
# Usage: ./test.sh [base_url]   (default: http://localhost:8000)

BASE="${1:-http://localhost:8000}"
PASS=0
FAIL=0

green='\033[0;32m'
red='\033[0;31m'
yellow='\033[0;33m'
nc='\033[0m'

pass() { echo -e "${green}PASS${nc} $1" >&2; ((PASS++)); }
fail() { echo -e "${red}FAIL${nc} $1" >&2; ((FAIL++)); }
header() { echo -e "\n${yellow}=== $1 ===${nc}" >&2; }

# Make a request, print pass/fail based on expected HTTP status.
# Returns the response body.
req() {
    local desc="$1"; local expected="$2"; shift 2
    local response; response=$(curl -s -w '\n%{http_code}' "$@")
    local body; body=$(echo "$response" | head -n -1)
    local status; status=$(echo "$response" | tail -n1)
    if [ "$status" = "$expected" ]; then
        pass "[$status] $desc"
    else
        fail "[$status != $expected] $desc  body: $body"
    fi
    echo "$body"
}

# ─── Setup: temp submission file ──────────────────────────────────────────────
TMPFILE=$(mktemp /tmp/submission_XXXX.txt)
echo "This is a test submission" > "$TMPFILE"
trap 'rm -f "$TMPFILE"' EXIT

# ─── Users ────────────────────────────────────────────────────────────────────
header "Users"

# Admin login (seeded by server on startup)
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@test.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-adminpass}"

body=$(req "Admin login" 200 \
    -X POST "$BASE/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
ADMIN_TOKEN=$(echo "$body" | jq -r '.token // empty')
if [ -z "$ADMIN_TOKEN" ]; then
    echo -e "${red}Cannot continue without admin token. Is the server running and seeded?${nc}" >&2
    exit 1
fi

# Create instructor
body=$(req "Create instructor" 200 \
    -X POST "$BASE/users" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Prof Smith","email":"smith@test.com","password":"pass123","role":"instructor"}')
INSTRUCTOR_ID=$(echo "$body" | jq -r '.id // empty')

# Create student
body=$(req "Create student" 200 \
    -X POST "$BASE/users" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Jane Doe","email":"jane@test.com","password":"pass123","role":"student"}')
STUDENT_ID=$(echo "$body" | jq -r '.id // empty')

# Instructor login
body=$(req "Instructor login" 200 \
    -X POST "$BASE/users/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"smith@test.com","password":"pass123"}')
INSTRUCTOR_TOKEN=$(echo "$body" | jq -r '.token // empty')

# Student login
body=$(req "Student login" 200 \
    -X POST "$BASE/users/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"jane@test.com","password":"pass123"}')
STUDENT_TOKEN=$(echo "$body" | jq -r '.token // empty')

# Get own user data
req "Get own user data (admin)" 200 \
    "$BASE/users/$STUDENT_ID" \
    -H "Authorization: Bearer $STUDENT_TOKEN" > /dev/null

req "Reject fetching another user's data" 401 \
    "$BASE/users/$INSTRUCTOR_ID" \
    -H "Authorization: Bearer $STUDENT_TOKEN" > /dev/null

# ─── Courses ──────────────────────────────────────────────────────────────────
header "Courses"

# List courses (public)
req "List courses (public)" 200 "$BASE/courses" > /dev/null

# Create course (admin only)
body=$(req "Create course" 201 \
    -X POST "$BASE/courses" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"subject\":\"CS\",\"number\":\"493\",\"title\":\"Cloud\",\"term\":\"sp26\",\"instructorid\":\"$INSTRUCTOR_ID\"}")
COURSE_ID=$(echo "$body" | jq -r '.id // empty')

req "Student cannot create course" 403 \
    -X POST "$BASE/courses" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"subject\":\"CS\",\"number\":\"493\",\"title\":\"Cloud\",\"term\":\"sp26\",\"instructorid\":\"$INSTRUCTOR_ID\"}" > /dev/null

# Get course (public, no students field)
body=$(req "Get course" 200 "$BASE/courses/$COURSE_ID")
if echo "$body" | jq -e '.students' > /dev/null 2>&1; then
    fail "GET /courses/:id should not include students field"
else
    pass "GET /courses/:id excludes students field"
fi

# Patch course (instructor)
req "Instructor can patch own course" 200 \
    -X PATCH "$BASE/courses/$COURSE_ID" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Cloud Application Development"}' > /dev/null

req "Student cannot patch course" 403 \
    -X PATCH "$BASE/courses/$COURSE_ID" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Hacked"}' > /dev/null

# Enroll student
req "Enroll student" 200 \
    -X POST "$BASE/courses/$COURSE_ID/students" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"add\":[\"$STUDENT_ID\"]}" > /dev/null

# Get students (instructor only)
req "Instructor can view students" 200 \
    "$BASE/courses/$COURSE_ID/students" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN" > /dev/null

req "Student cannot view student list" 403 \
    "$BASE/courses/$COURSE_ID/students" \
    -H "Authorization: Bearer $STUDENT_TOKEN" > /dev/null

# Roster CSV
body=$(req "Download roster CSV" 200 \
    "$BASE/courses/$COURSE_ID/roster" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN")
if echo "$body" | grep -q "Jane Doe"; then
    pass "Roster contains enrolled student"
else
    fail "Roster missing enrolled student"
fi

req "Student cannot download roster" 403 \
    "$BASE/courses/$COURSE_ID/roster" \
    -H "Authorization: Bearer $STUDENT_TOKEN" > /dev/null

# Filter courses
req "Filter courses by subject" 200 "$BASE/courses?subject=CS" > /dev/null
req "Filter courses by term" 200 "$BASE/courses?term=sp26" > /dev/null

# ─── Assignments ──────────────────────────────────────────────────────────────
header "Assignments"

body=$(req "Create assignment (instructor)" 201 \
    -X POST "$BASE/assignments" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"courseId\":\"$COURSE_ID\",\"title\":\"HW1\",\"points\":100,\"due\":\"2026-07-01T17:00:00Z\"}")
ASSIGNMENT_ID=$(echo "$body" | jq -r '.id // empty')

req "Student cannot create assignment" 403 \
    -X POST "$BASE/assignments" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"courseId\":\"$COURSE_ID\",\"title\":\"HW2\",\"points\":50,\"due\":\"2026-07-01T17:00:00Z\"}" > /dev/null

# Get assignment (public)
req "Get assignment (public)" 200 \
    "$BASE/assignments/$ASSIGNMENT_ID" > /dev/null

# List course assignments (public)
body=$(req "List course assignments" 200 \
    "$BASE/courses/$COURSE_ID/assignments")
if echo "$body" | jq -e '.assignments | length > 0' > /dev/null 2>&1; then
    pass "Course assignments list is non-empty"
else
    fail "Course assignments list is empty"
fi

# Patch assignment
req "Instructor can patch assignment" 200 \
    -X PATCH "$BASE/assignments/$ASSIGNMENT_ID" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Homework 1","points":110}' > /dev/null

req "Student cannot patch assignment" 403 \
    -X PATCH "$BASE/assignments/$ASSIGNMENT_ID" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Hacked"}' > /dev/null

# ─── Submissions ──────────────────────────────────────────────────────────────
header "Submissions"

body=$(req "Student can submit file" 201 \
    -X POST "$BASE/assignments/$ASSIGNMENT_ID/submissions" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -F "file=@$TMPFILE")
SUBMISSION_ID=$(echo "$body" | jq -r '.id // empty')

req "Instructor cannot submit" 403 \
    -X POST "$BASE/assignments/$ASSIGNMENT_ID/submissions" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN" \
    -F "file=@$TMPFILE" > /dev/null

body=$(req "Instructor can list submissions" 200 \
    "$BASE/assignments/$ASSIGNMENT_ID/submissions" \
    -H "Authorization: Bearer $INSTRUCTOR_TOKEN")
if echo "$body" | jq -e '.submissions | length > 0' > /dev/null 2>&1; then
    pass "Submissions list is non-empty"
else
    fail "Submissions list is empty"
fi

FILE_URL=$(echo "$body" | jq -r '.submissions[0].file // empty')
if [ -n "$FILE_URL" ]; then
    req "Download submission file" 200 \
        "$FILE_URL" \
        -H "Authorization: Bearer $INSTRUCTOR_TOKEN" > /dev/null
else
    fail "No file URL in submission"
fi

req "Student cannot list submissions" 403 \
    "$BASE/assignments/$ASSIGNMENT_ID/submissions" \
    -H "Authorization: Bearer $STUDENT_TOKEN" > /dev/null

# ─── 404s ─────────────────────────────────────────────────────────────────────
header "Not Found"
req "Unknown assignment" 404 "$BASE/assignments/000000000000000000000000" > /dev/null
req "Unknown course" 404 "$BASE/courses/000000000000000000000000" > /dev/null

# ─── Cleanup: delete course (cascades assignments + submissions) ───────────────
header "Cleanup"
req "Admin can delete course" 204 \
    -X DELETE "$BASE/courses/$COURSE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null

req "Deleted assignment is gone" 404 \
    "$BASE/assignments/$ASSIGNMENT_ID" > /dev/null

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "" >&2
echo -e "${green}Passed: $PASS${nc}  ${red}Failed: $FAIL${nc}  Total: $((PASS + FAIL))" >&2
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
