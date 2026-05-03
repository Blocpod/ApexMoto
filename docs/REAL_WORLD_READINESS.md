# Real-World Readiness

ApexMoto is functional for local and prototype field testing, with important production caveats.

## Ready Today

- Route planning with geocoding and public routing.
- GPX import/export.
- Live group ride rooms with invite codes.
- Browser geolocation ride tracking.
- Breadcrumb recovery through refresh.
- Ride journal persistence.
- SOS/hazard/breakdown incident logging.
- Emergency contact creation with call/text links.
- Garage and maintenance readiness tracking.
- API validation for required payloads.
- Browser-verified flows across Ride, Crew, Safety, and Garage.

## Safety Boundary

ApexMoto does not dispatch emergency services. SOS actions log an incident inside the app and expose call/text actions for saved contacts. A production safety release should integrate a verified notification provider and clearly test delivery guarantees.

## Production Requirements

Before public release:

- Add authentication and user ownership for all data.
- Replace JSON file storage with a durable database.
- Add database migrations and backups.
- Replace public map/geocoding/routing endpoints with production-grade providers.
- Add notification delivery for emergency contacts.
- Add privacy zones for home/work location masking.
- Add rate limiting and abuse protection.
- Add observability, structured logs, and uptime monitoring.
- Add automated unit/API/end-to-end test suites in CI.
- Add data export and deletion flows.

## Field Testing Checklist

- Confirm location permissions on iOS Safari, Android Chrome, and installed PWA mode.
- Test ride tracking under screen lock and low signal.
- Test route generation before riding into remote areas.
- Export GPX and verify import into common navigation devices/apps.
- Confirm emergency contact call/text links on the rider's device.
- Test group ride live updates with at least three riders.
- Verify battery impact during a ride longer than one hour.

## Known Constraints

- Browser geolocation support varies under lock screen.
- Public OSM/OSRM/Nominatim endpoints are not guaranteed for high-volume production.
- Live tracking currently depends on the app being open and connected.
- Emergency features currently log incidents and aid contact, but do not notify automatically.
