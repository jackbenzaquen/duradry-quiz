# Shopify content management

The six metaobject types are `dd_quiz_condition`, `dd_quiz_option`, `dd_quiz_question`, `dd_quiz_result`, `dd_quiz_rule`, and `dd_quiz_flow`.

| Editable content | Shopify location |
|---|---|
| Question headings, supporting text, input type and required state | Question entries |
| Button/answer labels, stable answer values and images | Option entries and flow UI labels |
| Conditional visibility | Question condition references |
| Recommendation conditions and priority | Rule entries |
| Result title and destination | Result entries |
| Ordered question/rule lists, default result, UI labels and version | Flow entry |
| Visual styling, selected flow and collection mode/proxy path | Theme customizer |

Install definitions before referenced entries. The installer orders references and supports dry-run; run `node shopify-content/tools/install-data.mjs --help` or read its usage output before applying. Keep public storefront access enabled for the referenced definitions and entries active. Merge the supplied translations into the existing locale file.

Content snapshots in Postgres are validation/audit copies. Shopify remains the editing source. Bump the flow version after every content/routing edit, and verify a new submission with that version before wider release. Do not change or reuse question keys to mean a different question.

The default routing is a draft: underarms-only → Sweat Control Trio; underarms plus another sweat area → Signature Starter Kit; other sweat areas → Body Care Starter Kit. Cream/red gift choice selects the corresponding result page. Exact hidden Octane rules need a configuration export or merchant review.
