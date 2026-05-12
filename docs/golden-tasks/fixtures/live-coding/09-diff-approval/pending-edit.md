# Pending edit — awaiting approval

Tool call: `edit_file`
Target: `src/greet.ts`
Reason: "Add TODO(owner) marker per user request"

## Diff preview

```diff
 export function greet(name: string): string {
+    // TODO(owner): personalize greeting once locale service lands
     return `Hello, ${name}!`;
 }
```

Status: **pending user approval**. No bytes have been written. A deny
would leave `src/greet.ts` unchanged.
