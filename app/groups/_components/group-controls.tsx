"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveGroup,
  createGroup,
  joinGroup,
  removeMember,
  renameGroup,
  revokeInvitation,
  rotateInvitation,
  type GroupActionResult,
  type GroupFormState,
} from "../actions";

const idle: GroupFormState = { status: "idle" };

/** The "name + button" form used to create and to rename a group. */
function GroupNameForm({
  action,
  label,
  submitLabel,
  pendingLabel,
  defaultValue = "",
}: {
  readonly action: (previous: GroupFormState, formData: FormData) => Promise<GroupFormState>;
  readonly label: string;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly defaultValue?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const [, startTransition] = useTransition();

  // Submit without React's automatic reset, so the typed name stays after an error.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const hasError = state.status === "error" && state.message !== undefined;
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-2">
      <Label htmlFor="group-name">{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="group-name"
          name="name"
          defaultValue={defaultValue}
          placeholder="e.g. Weekend Tennis Crew"
          maxLength={60}
          aria-invalid={hasError}
          aria-describedby={hasError ? "group-name-error" : undefined}
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
      {hasError && (
        <p id="group-name-error" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.status === "saved" && <p role="status" className="text-sm text-success">{state.message}</p>}
    </form>
  );
}

/** UC1-06: create a new group (Groups page). */
export function CreateGroupForm() {
  return (
    <GroupNameForm action={createGroup} label="New group name" submitLabel="Create group" pendingLabel="Creating…" />
  );
}

/** UC1-06: owner renames the group. */
export function RenameGroupForm({ groupId, name }: { readonly groupId: string; readonly name: string }) {
  return (
    <GroupNameForm
      action={renameGroup.bind(null, groupId)}
      label="Group name"
      submitLabel="Save name"
      pendingLabel="Saving…"
      defaultValue={name}
    />
  );
}

/** Shows the invitation link with a Copy button. */
export function InvitationLink({ url }: { readonly url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input readOnly value={url} aria-label="Invitation link" onFocus={(event) => event.currentTarget.select()} />
      <Button type="button" variant="outline" className="shrink-0" onClick={copy}>
        {copied ? "Copied!" : "Copy link"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </div>
  );
}

/** A plain button that runs one group action and shows any refusal under it. */
function ActionButton({
  run,
  label,
  pendingLabel,
  variant = "outline",
}: {
  readonly run: () => Promise<GroupActionResult>;
  readonly label: string;
  readonly pendingLabel: string;
  readonly variant?: "outline" | "destructive" | "default";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await run();
            if (result?.error !== undefined) setError(result.error);
          })
        }
      >
        {pending ? pendingLabel : label}
      </Button>
      {error !== null && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}

/** Owner: issue a new link, or turn the link off. */
export function InvitationControls({ groupId, active }: { readonly groupId: string; readonly active: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton
        run={() => rotateInvitation(groupId)}
        label={active ? "Make a new link" : "Turn link on (new link)"}
        pendingLabel="Making link…"
      />
      {active && (
        <ActionButton run={() => revokeInvitation(groupId)} label="Turn link off" pendingLabel="Turning off…" />
      )}
    </div>
  );
}

/** Owner: remove one member, after a confirmation. */
export function RemoveMemberButton({
  groupId,
  memberId,
  memberName,
}: {
  readonly groupId: string;
  readonly memberId: string;
  readonly memberName: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive">
          Remove
        </Button>
      }
      title={`Remove ${memberName}?`}
      description="They leave this group and can only rejoin with a current invitation link."
      confirmLabel="Remove member"
      destructive
      onConfirm={async () => {
        const result = await removeMember(groupId, memberId);
        if (result.error !== undefined) throw new Error(result.error);
      }}
    />
  );
}

/** Owner: archive the group, after a confirmation. */
export function ArchiveGroupButton({ groupId }: { readonly groupId: string }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Archive group</Button>}
      title="Archive this group?"
      description="The invitation link is turned off and the group can no longer be changed. Members keep their history."
      confirmLabel="Archive group"
      destructive
      onConfirm={async () => {
        const result = await archiveGroup(groupId);
        if (result.error !== undefined) throw new Error(result.error);
      }}
    />
  );
}

/** Join page: the "Join group" button. On success the server opens the group page. */
export function JoinGroupButton({ token, groupName }: { readonly token: string; readonly groupName: string }) {
  return (
    <div className="space-y-3">
      <InfoNote>You can leave only by asking the owner to remove you.</InfoNote>
      <ActionButton run={() => joinGroup(token)} label={`Join ${groupName}`} pendingLabel="Joining…" variant="default" />
    </div>
  );
}