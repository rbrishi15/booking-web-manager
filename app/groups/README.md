# /app/groups

**Owner:** Joseph (Jolingoes)

UC1-06 Manage Group: creation, invitation links, membership management.

The group directory uses two columns of image cards on desktop and a single
column on smaller screens. The reference styling applies to dark mode; light
mode has separate surfaces and contrast. “Create group” opens an accessible
dialog containing the existing creation form. The shared app sidebar and group
detail controls are unchanged.

Cards show membership counts, the first four members' initials, the viewer's
role and join date, invitation status, and archived state. Display names are
fetched in one deduplicated batch after the authenticated membership query;
only display summaries reach the client. Invitation tokens and member IDs stay
on the server. Court covers are decorative; groups do not currently have
descriptions or uploaded cover/profile photos. See the browser fixtures in
`_components/groups-view.stories.tsx` for empty, single-member, archived, long-name,
mobile, and dark-mode cases.

| Action | Who | Rule |
| --- | --- | --- |
| Create, rename, archive, link on/off | Owner | Only the owner; an archived group can't change. |
| Join | Anyone with a current link | Joining twice is harmless. |
| Remove a member | Owner | The owner can't be removed. |
| Leave | Any member except the owner | The owner archives the group instead. Leaving works like a removal: rejoin only with a current link; joined sessions are unaffected. See [ADR-0017](../../docs/adr/0017-members-leave-regular-groups.md). |

Leaving asks for confirmation on the group page, then opens `/groups?left=1`,
which confirms "You left the group."
