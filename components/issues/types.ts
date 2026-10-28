import type { BarcodeDetail, ProjectCategory, ProjectStatus } from "@/lib/issues";

export interface GroupMemberOption {
  id: string;
  name: string;
  employeeNo: string;
  isLeader: boolean;
}

export interface GroupDirectoryEntry {
  id: string;
  name: string;
  enabled: boolean;
  members: GroupMemberOption[];
}

export type TransferSelection =
  | { kind: "barcode"; barcodeId: string; label: string }
  | { kind: "issue"; issueId: string; barcodeId: string; label: string }
  | { kind: "bulk"; barcodeIds: string[]; label: string };

export type StatusSelection =
  | { kind: "barcode"; barcodeId: string; label: string }
  | { kind: "issue"; issueId: string; label: string }
  | { kind: "bulk"; barcodeIds: string[]; label: string };

export interface IssueWorkspaceProps {
  projectId: string;
  currentUser: { id: string; name: string; employeeNo: string };
  access: {
    isPm: boolean;
    isSupervisor: boolean;
    isGroupLeader: boolean;
    groupIds: string[];
    leaderGroupIds: string[];
  };
  groups: GroupDirectoryEntry[];
  defaultGroupIds: string[];
  statuses: ProjectStatus[];
  categories: ProjectCategory[];
  initialBarcodeId?: string;
  initialBarcodeLabel?: string;
  initialOpenCreate?: boolean;
}

export type { BarcodeDetail };
