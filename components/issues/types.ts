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
  /** 软件包与归属节点（问题分类）的关联，用于按节点反查使用的软件包。 */
  nodePackages: { id: string; code: string; name: string; nodeId: string | null }[];
  initialBarcodeId?: string;
  initialBarcodeLabel?: string;
  initialOpenCreate?: boolean;
}

export type { BarcodeDetail };
