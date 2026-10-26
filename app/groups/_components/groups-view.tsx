"use client";

import { ArrowRight, Check, Plus, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { initials } from "@/components/ui/initials";
import styles from "./groups-view.module.css";

/** Display-only data: invitation tokens and member IDs stay on the server. */
export interface GroupSummary {
  readonly groupId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly memberNames: readonly string[];
  readonly joinedAt: string | null;
  readonly isOwner: boolean;
  readonly archived: boolean;
  readonly invitationActive: boolean;
}

interface GroupsViewProps {
  readonly groups: readonly GroupSummary[];
  readonly left: boolean;
  readonly createForm: ReactNode;
}

const joinedDate = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" });
const covers = ["/images/sessions/court.webp", "/images/sports/tennis.jpg", "/images/session-court.webp", "/images/groups/racket-court.webp"];

export function GroupsView({ groups, left, createForm }: GroupsViewProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Groups</p>
          <h1>Your groups</h1>
          <p className={styles.intro}>Play together. Organise sessions with your regular players.</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className={styles.createButton}><Plus size={20} strokeWidth={1.5} aria-hidden />Create group</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create a group</DialogTitle>
              <DialogDescription>Your regular players, all in one place. Create a group, then share its invitation link.</DialogDescription>
            </DialogHeader>
            {createForm}
          </DialogContent>
        </Dialog>
      </header>
      <section className={styles.content} aria-label="Group directory">
        {left && <p role="status" className={styles.notice}><Check size={17} aria-hidden />You left the group.</p>}
        {groups.length > 0 ? (
          <ul aria-label="Your groups" className={styles.groups}>
            {groups.map((group, index) => <GroupCard key={group.groupId} group={group} coverIndex={index % covers.length} priority={index < 2} />)}
          </ul>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Users size={32} strokeWidth={1.25} aria-hidden /></span>
            <p className={styles.eyebrow}>Better together</p>
            <h2>Your next game starts here</h2>
            <p>Create a group for the people you play with.<br />Share the invitation link and make it a regular thing.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function GroupCard({ group, coverIndex, priority }: { readonly group: GroupSummary; readonly coverIndex: number; readonly priority: boolean }) {
  const remaining = Math.max(0, group.memberCount - group.memberNames.length);
  const invitation = group.archived ? "This group is archived" : group.invitationActive ? "Invitation link active" : "Invitation link turned off";

  return (
    <li className={styles.card}>
      <Link href={`/groups/${group.groupId}`} className={styles.groupLink}>
        <span className={`${styles.cover} ${styles[`cover${coverIndex}`]}`}>
          <Image src={covers[coverIndex] ?? "/images/session-court.webp"} alt="" fill priority={priority} sizes="(min-width: 1440px) calc((100vw - 384px) / 2), (min-width: 1000px) calc((100vw - 340px) / 2), (min-width: 768px) calc(100vw - 280px), calc(100vw - 40px)" />
        </span>
        <div className={styles.cardBody}>
          <div className={styles.titleRow}>
            <h2 className={styles.groupName}>{group.name}</h2>
            <span className={styles.badges}>
              <span className={`${styles.role} ${group.isOwner ? styles.owner : ""}`}>{group.isOwner ? "Owner" : "Member"}</span>
              {group.archived && <span className={styles.archived}>Archived</span>}
            </span>
          </div>
          <div className={styles.members}>
            <span className={styles.avatars} aria-hidden>
              {group.memberNames.map((name, index) => <span key={index} className={styles.avatar} title={name}>{initials(name)}</span>)}
              {remaining > 0 && <span className={styles.overflow}>+{remaining}</span>}
            </span>
            <span aria-hidden className={styles.dot}>·</span>
            <span className={styles.memberCount}>{group.memberCount} {group.memberCount === 1 ? "member" : "members"}</span>
            <span className="sr-only">Members include {group.memberNames.join(", ")}.</span>
          </div>
          <p className={styles.description}>
            {invitation}{group.joinedAt && <> · Joined <time dateTime={group.joinedAt}>{joinedDate.format(new Date(group.joinedAt))}</time></>}
          </p>
          <ArrowRight className={styles.arrow} size={23} strokeWidth={1.3} aria-hidden />
        </div>
      </Link>
    </li>
  );
}
