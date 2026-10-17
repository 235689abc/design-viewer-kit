# Security policy

Design Viewer Kit is a read-only design inventory viewer. It is intended to
consume a checked-in JSON manifest or a GET-only runtime adapter; it does not
execute migrations, mutate application data, or restart services.

Please do not publish credentials, tokens, private URLs, customer data, or
unredacted architecture in an issue or pull request. A generated index can
reveal service names, table names, routes, and source paths, so review it as
an internal artifact before publishing.

To report a security issue, open a private GitHub security advisory when the
repository supports it. If that is unavailable, contact the repository
maintainer privately and include a minimal reproduction without secrets.

