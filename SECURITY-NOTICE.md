# SECURITY NOTICE

A real SESSION_SECRET was accidentally committed to this branch's wrangler.toml
(commit c19fa17). It has been stripped from the file, but the value remains in
this branch's git history. The leaked secret MUST be rotated on Cloudflare so
the old value stops working — rewriting history alone does not invalidate it.

This branch is superseded by main and is safe to delete after rotation.
