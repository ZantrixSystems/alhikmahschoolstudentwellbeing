# Security Principles

- least privilege by default
- server-side enforcement for every sensitive decision
- audit logging for sensitive administration and notable reads
- no raw SQL from user input
- strict allowlists for structured filtering
- redaction over overexposure
- separate Google authentication from internal app authorisation
- domain restriction configurable and enforced server-side
- deployment should keep database credentials outside Apps Script
