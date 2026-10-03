# Proposal: `DELETE /v1/workouts/{workoutId}`

Request to Hevy for a delete operation on the public API, matching the
documented conventions of the existing spec (OpenAPI 3.0.0, per-operation
`api-key` header, `Workout` schema, `{ "error": string }` problem responses).
The mobile application can delete workouts today; the public API has no
equivalent, so integrations cannot reach feature parity for account
management.

## Spec fragment (drop-in for `paths`)

```yaml
/v1/workouts/{workoutId}:
  delete:
    tags:
      - Workouts
    summary: Delete an existing workout
    description: >
      Permanently deletes a workout from the authenticated account by its id.
      Deletion is permanent and cannot be undone. A delete event is emitted
      to /v1/workouts/events so clients that keep a local workout cache can
      remove the workout from it as well.
    parameters:
      - in: header
        name: api-key
        schema:
          type: string
          format: uuid
        required: true
      - name: workoutId
        in: path
        description: The id of the workout
        required: true
    responses:
      "200":
        description: The workout was successfully deleted
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Workout"
      "401":
        description: Unauthorized
      "404":
        description: Workout not found
```

## Example

```http
DELETE /v1/workouts/f1085cdb-32b2-4003-967d-53a3af8eaecb HTTP/1.1
Host: api.hevyapp.com
api-key: <account api key>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "f1085cdb-32b2-4003-967d-53a3af8eaecb",
  "title": "Pull day",
  "routine_id": null,
  "description": "",
  "start_time": "2026-10-01T18:07:06+00:00",
  "end_time": "2026-10-01T18:55:46+00:00",
  "updated_at": "2026-10-01T18:56:22.069Z",
  "created_at": "2026-10-01T18:56:22.069Z",
  "exercises": [ ... ]
}
```

## Notes and rationale

- **Verified absent.** As of October 2026, `DELETE /v1/workouts/{workoutId}`
  is not implemented server-side: the API answers the framework's
  `Cannot DELETE /v1/workouts/...` 404 (route not found), including for
  well-formed ids. The `DeletedWorkout` schema in the current spec describes
  only the delete events surfaced by `GET /v1/workouts/events`; no path
  references it as an operation response.
- **Return value.** Returning the deleted `Workout` mirrors the `PUT`
  response style and lets callers confirm exactly what was removed (useful
  for audit logs and undo prompts). If a lighter response is preferred, a
  bare `204 No Content` would also work; the important part is the status
  contract for missing ids.
- **Idempotency.** Repeating a delete for an already-deleted or unknown id
  returns `404 Workout not found`, matching `GET /v1/workouts/{workoutId}`.
- **Cache coherence.** `GET /v1/workouts/events` already models `update` and
  `delete` event kinds for phone-app changes. Deletes performed through the
  API should emit the same delete event so cache-based clients converge.
- **No request body.** The path is the full address of the resource; no
  parameters beyond authentication are needed.
- **Authorization.** The existing account-scoped `api-key` is sufficient; no
  new scopes or consent flow are required.

Companion MCP integration context: an MCP client (ChatGPT) that manages
workouts on the user's behalf currently must refuse delete requests; with
this endpoint it could complete the workflow end to end.
