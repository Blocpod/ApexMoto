# ApexMoto API

Base URL in local development:

```text
http://localhost:4173
```

## Health

`GET /health`

Returns API availability.

## Routes

`GET /routes`

Returns saved routes.

`POST /routes`

Creates a route.

Required:

- `name`
- `waypoints` with at least two `[longitude, latitude]` points

## Groups

`GET /groups`

Returns ride rooms.

`POST /groups`

Creates a ride room.

Required:

- `name`

`POST /groups/:code/join`

Adds or updates a rider in a ride room.

Required:

- `name`

`PATCH /groups/:id`

Updates ride room metadata.

## Garage

`GET /garage`

Returns bikes and service tasks.

`POST /garage`

Creates a bike.

Required:

- `name`

`PATCH /garage/:id`

Updates bike fields.

`POST /garage/:id/tasks`

Creates a service task.

Required:

- `label`

`PATCH /garage/:id/tasks/:taskId`

Updates a service task, including completion.

## Rides

`GET /rides`

Returns saved ride journals.

`POST /rides`

Creates a ride journal entry.

Required:

- `name`

## Incidents

`GET /incidents`

Returns safety incidents.

`POST /incidents`

Creates a safety incident.

Required:

- `type`

`PATCH /incidents/:id`

Updates incident status or metadata.

## Contacts

`GET /contacts`

Returns emergency contacts.

`POST /contacts`

Creates an emergency contact.

Required:

- `name`
- `phone`

## Socket.IO Events

Client to server:

- `group:join`
- `rider:position`
- `ride:beacon`

Server to client:

- `live:snapshot`
- `rider:position`
- `group:update`
- `incident:new`
- `incident:update`
