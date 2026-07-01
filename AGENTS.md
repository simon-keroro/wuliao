# Project Instructions

## Version Rule

For any user-visible feature upgrade, workflow change, UI change, or data logic
change, update the app version in `lib/version.ts` during the same change set.

Before the final response, check whether `APP_VERSION` should be incremented.
When it is incremented, mention the new version in the final response.
