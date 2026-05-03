# Security Notes

## Current State

ApexMoto is a prototype-ready full-stack app. It does not yet include authentication, authorization, or multi-tenant data isolation.

## Required Before Public Launch

- User authentication.
- Per-user and per-group authorization.
- HTTPS-only deployment.
- API rate limiting.
- Request size limits per endpoint.
- Input validation at every API boundary.
- Secrets management through environment variables.
- Data deletion and export controls.
- Audit logging for safety and incident actions.
- Notification provider verification for emergency messaging.

## Privacy Considerations

Motorcycle riding apps handle sensitive location and routine data. Production ApexMoto should support:

- Privacy zones around home, work, and frequent stops.
- Configurable live location sharing.
- Expiring live ride links.
- Clear consent before joining or broadcasting to group rides.
- Secure storage for emergency contact data.

## Emergency Disclaimer

The current SOS flow logs an incident and gives the rider contact actions. It does not dispatch emergency services or guarantee notification delivery.
