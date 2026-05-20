# OS Primitives
#
# Each subdirectory here is one OS Primitive extracted via a discrete PR
# per ARCH-007 (Selective Extraction). Extraction checklist per PR:
#
#   [ ] Source reviewed against SEC-1 through SEC-8
#   [ ] Source reviewed against SEC-14 through SEC-20
#   [ ] Zero MemPalace references (grep confirmed)
#   [ ] SEC-17 Trivy CVE scan clean
#   [ ] Locksmith sign-off obtained (SEC-16 for auth primitive only)
#
# Primitives: store_memory, search_memory, search_sops,
#             store_thought, query_thoughts, ratify_thought,
#             get_disposition, set_disposition
