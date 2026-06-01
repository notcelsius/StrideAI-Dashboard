"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProjectSubjects,
  getProjectGroups,
  createSubject,
  createEnrollmentCode,
  linkPatientSubject,
  updateSubjectGroups,
  upsertProjectGroup,
  archiveProjectGroup,
} from "@/lib/dashboardApi";
import { useStudy } from "@/app/dashboard/StudyProvider";

function selectedValues(event) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function uniqueValues(values) {
  return Array.from(new Set((values || []).map(String).filter(Boolean)));
}

export default function SubjectsPage() {
  const { session, selectedProjectId, selectedProject } = useStudy();

  const [subjects, setSubjects] = useState([]);
  const [projectGroups, setProjectGroups] = useState([]);
  const [isGroupsLoading, setIsGroupsLoading] = useState(false);

  const [linkSub, setLinkSub] = useState("");
  const [linkSubjectId, setLinkSubjectId] = useState("");
  const [linkStatus, setLinkStatus] = useState("");

  const [enrollSubjectId, setEnrollSubjectId] = useState("");
  const [enrollParticipant, setEnrollParticipant] = useState("");
  const [enrollStatus, setEnrollStatus] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  const [newGroupName, setNewGroupName] = useState("");
  const [groupSettingsStatus, setGroupSettingsStatus] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState("");
  const [renameGroupName, setRenameGroupName] = useState("");

  const [newSubjectId, setNewSubjectId] = useState("");
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newSubjectGroupIds, setNewSubjectGroupIds] = useState([]);
  const [createSubjectStatus, setCreateSubjectStatus] = useState("");

  const [selectedSubjectIds, setSelectedSubjectIds] = useState(() => new Set());
  const [bulkGroupIds, setBulkGroupIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [editingSubject, setEditingSubject] = useState(null);
  const [editGroupIds, setEditGroupIds] = useState([]);

  const activeGroupOptions = useMemo(() => projectGroups, [projectGroups]);
  const editGroupOptions = useMemo(() => {
    const byId = new Map();
    for (const group of projectGroups) {
      byId.set(group.groupId, group);
    }
    for (const group of editingSubject?.groups || []) {
      if (group.groupId && !byId.has(group.groupId)) {
        byId.set(group.groupId, group);
      }
    }
    return Array.from(byId.values()).sort((a, b) => (a.groupName || a.groupId).localeCompare(b.groupName || b.groupId));
  }, [projectGroups, editingSubject]);

  function groupsForIds(groupIds, options = activeGroupOptions) {
    const byId = new Map(options.map((group) => [group.groupId, group]));
    return uniqueValues(groupIds)
      .map((groupId) => byId.get(groupId))
      .filter(Boolean)
      .map((group) => ({ groupId: group.groupId, groupName: group.groupName }));
  }

  async function refreshProjectGroups() {
    if (!session || !selectedProjectId) {
      setProjectGroups([]);
      return [];
    }
    setIsGroupsLoading(true);
    try {
      const payload = await getProjectGroups(session, selectedProjectId);
      const groups = payload.groups || [];
      setProjectGroups(groups);
      return groups;
    } catch (err) {
      setGroupSettingsStatus(err.message);
      return [];
    } finally {
      setIsGroupsLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !selectedProjectId) {
      setSubjects([]);
      setProjectGroups([]);
      return;
    }
    setSelectedSubjectIds(new Set());
    setBulkGroupIds([]);
    setNewSubjectGroupIds([]);
    setEditingSubject(null);
    setEditGroupIds([]);
    setGroupSettingsStatus("");
    let isMounted = true;
    async function load() {
      setIsGroupsLoading(true);
      try {
        const [subjectsPayload, groupsPayload] = await Promise.all([
          getProjectSubjects(session, selectedProjectId),
          getProjectGroups(session, selectedProjectId),
        ]);
        if (!isMounted) return;
        setSubjects(subjectsPayload.subjects || []);
        setProjectGroups(groupsPayload.groups || []);
      } catch (err) {
        if (isMounted) setGroupSettingsStatus(err.message);
      } finally {
        if (isMounted) setIsGroupsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [session, selectedProjectId]);

  async function reloadSubjects() {
    const payload = await getProjectSubjects(session, selectedProjectId);
    setSubjects(payload.subjects || []);
  }

  async function handleLink(e) {
    e.preventDefault();
    setLinkStatus("");
    if (!linkSub || !linkSubjectId || !selectedProjectId) {
      setLinkStatus("All fields are required.");
      return;
    }
    try {
      await linkPatientSubject(session, linkSub, linkSubjectId, selectedProjectId);
      setLinkStatus("Patient linked successfully.");
      setLinkSub("");
      setLinkSubjectId("");
      await reloadSubjects();
    } catch (err) {
      setLinkStatus(err.message);
    }
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    setGroupSettingsStatus("");
    const groupName = newGroupName.trim();
    if (!groupName || !selectedProjectId) {
      setGroupSettingsStatus("Group name is required.");
      return;
    }
    try {
      await upsertProjectGroup(session, { projectId: selectedProjectId, groupName });
      setNewGroupName("");
      setGroupSettingsStatus("Group name saved.");
      await refreshProjectGroups();
    } catch (err) {
      setGroupSettingsStatus(err.message);
    }
  }

  function startRenameGroup(group) {
    setRenamingGroupId(group.groupId);
    setRenameGroupName(group.groupName || group.groupId);
    setGroupSettingsStatus("");
  }

  async function handleRenameGroup(group) {
    setGroupSettingsStatus("");
    const groupName = renameGroupName.trim();
    if (!groupName) {
      setGroupSettingsStatus("Group name is required.");
      return;
    }
    try {
      await upsertProjectGroup(session, {
        projectId: selectedProjectId,
        groupId: group.groupId,
        groupName,
      });
      setRenamingGroupId("");
      setRenameGroupName("");
      setGroupSettingsStatus("Group name updated.");
      await refreshProjectGroups();
      await reloadSubjects();
    } catch (err) {
      setGroupSettingsStatus(err.message);
    }
  }

  async function handleArchiveGroup(group) {
    setGroupSettingsStatus("");
    if (!window.confirm(`Archive group "${group.groupName || group.groupId}"?`)) return;
    try {
      await archiveProjectGroup(session, selectedProjectId, group.groupId);
      setGroupSettingsStatus("Group archived.");
      await refreshProjectGroups();
    } catch (err) {
      setGroupSettingsStatus(err.message);
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault();
    setCreateSubjectStatus("");
    if (!newSubjectId || !selectedProjectId) {
      setCreateSubjectStatus("Subject ID is required.");
      return;
    }
    const initialGroups = groupsForIds(newSubjectGroupIds);
    try {
      await createSubject(session, newSubjectId, selectedProjectId, newParticipantName, initialGroups);
      setCreateSubjectStatus("Subject created successfully.");
      setNewSubjectId("");
      setNewParticipantName("");
      setNewSubjectGroupIds([]);
      await reloadSubjects();
    } catch (err) {
      setCreateSubjectStatus(err.message);
    }
  }

  async function handleBulkGroup(mode) {
    setBulkStatus("");
    const subjectIds = Array.from(selectedSubjectIds);
    if (!subjectIds.length || !selectedProjectId) {
      setBulkStatus("Select at least one subject.");
      return;
    }
    const groups = mode === "clear" ? [] : groupsForIds(bulkGroupIds);
    if (mode !== "clear" && !groups.length) {
      setBulkStatus("Select at least one group.");
      return;
    }
    try {
      await updateSubjectGroups(session, {
        projectId: selectedProjectId,
        subjectIds,
        groups,
        mode,
      });
      await reloadSubjects();
      setSelectedSubjectIds(new Set());
      setBulkGroupIds([]);
      setBulkStatus(`${mode === "clear" ? "Cleared" : mode === "remove" ? "Removed" : "Updated"} groups on ${subjectIds.length} subject${subjectIds.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setBulkStatus(err.message);
    }
  }

  function openEditModal(subject) {
    setEditingSubject(subject);
    setEditGroupIds((subject.groups || []).map((group) => group.groupId).filter(Boolean));
  }

  async function handleEditSave(mode) {
    if (!editingSubject) return;
    const groups = mode === "clear" ? [] : groupsForIds(editGroupIds, editGroupOptions);
    const nextMode = mode === "clear" || groups.length ? mode : "clear";
    try {
      await updateSubjectGroups(session, {
        projectId: selectedProjectId,
        subjectIds: [editingSubject.subjectId],
        groups,
        mode: nextMode,
      });
      await reloadSubjects();
      setEditingSubject(null);
      setEditGroupIds([]);
    } catch (err) {
      setBulkStatus(err.message);
    }
  }

  function toggleSubjectSelected(subjectId) {
    setSelectedSubjectIds((current) => {
      const next = new Set(current);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedSubjectIds((current) => {
      if (subjects.length && subjects.every((subject) => current.has(subject.subjectId))) {
        return new Set();
      }
      return new Set(subjects.map((subject) => subject.subjectId));
    });
  }

  async function handleEnroll(e) {
    e.preventDefault();
    setEnrollStatus("");
    setGeneratedCode("");
    if (!enrollSubjectId || !selectedProjectId) {
      setEnrollStatus("Subject ID is required.");
      return;
    }
    try {
      const result = await createEnrollmentCode(session, enrollSubjectId, selectedProjectId, enrollParticipant);
      setGeneratedCode(result.code);
      setEnrollStatus(`Code generated for ${result.participantName || result.subjectId}.`);
      setEnrollSubjectId("");
      setEnrollParticipant("");
    } catch (err) {
      setEnrollStatus(err.message);
    }
  }

  if (!selectedProjectId) {
    return (
      <section className="panel">
        <h2>Subjects &amp; Groups</h2>
        <p className="empty-state">Select a study from the switcher above to manage its subjects and groups.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Subjects &amp; Groups</p>
        <h1 className="study-heading">
          {selectedProject ? `${selectedProject.projectName} · ${selectedProject.projectId}` : selectedProjectId}
        </h1>
      </section>

      <section className="panel">
        <h2>Current Subjects</h2>
        {selectedSubjectIds.size > 0 ? (
          <div className="bulk-action-bar">
            <span className="bulk-action-count">{selectedSubjectIds.size} selected</span>
            <select
              multiple
              className="multi-select bulk-group-select"
              value={bulkGroupIds}
              onChange={(e) => setBulkGroupIds(selectedValues(e))}
              disabled={!activeGroupOptions.length}
              aria-label="Select groups for selected subjects"
            >
              {activeGroupOptions.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.groupName}
                </option>
              ))}
            </select>
            <button type="button" className="primary-btn" onClick={() => handleBulkGroup("replace")}>
              Replace
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleBulkGroup("add")}>
              Add
            </button>
            <button type="button" className="secondary-btn" onClick={() => handleBulkGroup("remove")}>
              Remove
            </button>
            <button type="button" className="danger-btn" onClick={() => handleBulkGroup("clear")}>
              Clear all
            </button>
          </div>
        ) : null}
        {bulkStatus ? (
          <p className={/^(Cleared|Updated|Removed)/.test(bulkStatus) ? "success-text" : "error-text"}>
            {bulkStatus}
          </p>
        ) : null}
        {subjects.length === 0 ? (
          <p className="subtext">No subjects in this project.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={subjects.length > 0 && subjects.every((subject) => selectedSubjectIds.has(subject.subjectId))}
                      onChange={toggleSelectAllOnPage}
                      aria-label="Select all subjects"
                    />
                  </th>
                  <th>Subject ID</th>
                  <th>Participant</th>
                  <th>Groups</th>
                  <th>Status</th>
                  <th>Linked User Sub</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.subjectId} className="subject-row">
                    <td>
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        checked={selectedSubjectIds.has(s.subjectId)}
                        onChange={() => toggleSubjectSelected(s.subjectId)}
                        aria-label={`Select ${s.subjectId}`}
                      />
                    </td>
                    <td className="subject-link">{s.subjectId}</td>
                    <td>{s.participantName}</td>
                    <td>
                      {(s.groups || []).length ? (
                        <span className="group-chip-list">
                          {s.groups.map((group) => (
                            <span key={group.groupId} className="group-chip">
                              {group.groupName}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="group-chip group-chip-muted">ungrouped</span>
                      )}
                    </td>
                    <td>{s.status}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{s.userSub || "—"}</td>
                    <td>
                      <button type="button" className="secondary-btn" onClick={() => openEditModal(s)}>
                        Edit groups
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>Group Settings</h2>
            <p className="subtext">Project group names available for subject assignment.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={refreshProjectGroups}>
            Refresh
          </button>
        </div>
        <form onSubmit={handleCreateGroup} className="admin-form group-settings-form">
          <label>
            Group Name
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Control Group"
            />
          </label>
          <button type="submit" className="primary-btn">Add Group</button>
        </form>
        {groupSettingsStatus ? (
          <p className={/saved|updated|archived/i.test(groupSettingsStatus) ? "success-text" : "error-text"}>
            {groupSettingsStatus}
          </p>
        ) : null}
        {isGroupsLoading ? <p className="subtext">Loading groups...</p> : null}
        {!isGroupsLoading && activeGroupOptions.length === 0 ? (
          <p className="subtext">No group names configured for this project.</p>
        ) : null}
        {!isGroupsLoading && activeGroupOptions.length > 0 ? (
          <div className="group-settings-list">
            {activeGroupOptions.map((group) => (
              <div key={group.groupId} className="group-settings-row">
                {renamingGroupId === group.groupId ? (
                  <>
                    <input
                      type="text"
                      value={renameGroupName}
                      onChange={(e) => setRenameGroupName(e.target.value)}
                      aria-label={`Rename ${group.groupName}`}
                    />
                    <button type="button" className="primary-btn" onClick={() => handleRenameGroup(group)}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setRenamingGroupId("");
                        setRenameGroupName("");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="group-chip">{group.groupName}</span>
                    <span className="group-id-text">{group.groupId}</span>
                    <button type="button" className="secondary-btn" onClick={() => startRenameGroup(group)}>
                      Rename
                    </button>
                    <button type="button" className="danger-btn" onClick={() => handleArchiveGroup(group)}>
                      Archive
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {editingSubject ? (
        <div className="modal-backdrop" onClick={() => setEditingSubject(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Edit groups · {editingSubject.subjectId}</h3>
            <label className="field-label">
              Groups
              <select
                multiple
                className="multi-select"
                value={editGroupIds}
                onChange={(e) => setEditGroupIds(selectedValues(e))}
                aria-label={`Groups for ${editingSubject.subjectId}`}
              >
                {editGroupOptions.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.groupName}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setEditingSubject(null)}>
                Cancel
              </button>
              <button type="button" className="danger-btn" onClick={() => handleEditSave("clear")}>
                Clear
              </button>
              <button type="button" className="primary-btn" onClick={() => handleEditSave("replace")}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <h2>Create Subject</h2>
        <p className="subtext">Add a new subject to the current study before generating an enrollment code.</p>
        <form onSubmit={handleCreateSubject} className="admin-form" style={{ maxWidth: "480px" }}>
          <label>
            Subject ID
            <input
              type="text"
              value={newSubjectId}
              onChange={(e) => setNewSubjectId(e.target.value)}
              placeholder="e.g. SUB_001"
            />
          </label>
          <label>
            Participant Name <span className="subtext">(optional)</span>
            <input
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </label>
          <label>
            Groups <span className="subtext">(optional)</span>
            <select
              multiple
              className="multi-select"
              value={newSubjectGroupIds}
              onChange={(e) => setNewSubjectGroupIds(selectedValues(e))}
              disabled={!activeGroupOptions.length}
            >
              {activeGroupOptions.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.groupName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary-btn">Create Subject</button>
          {createSubjectStatus && (
            <p className={createSubjectStatus.includes("success") ? "success-text" : "error-text"}>
              {createSubjectStatus}
            </p>
          )}
        </form>
      </section>

      <section className="panel">
        <h2>Generate Enrollment Code</h2>
        <p className="subtext">Create a one-time code for a patient to enroll in the study via the mobile app.</p>
        <form onSubmit={handleEnroll} className="admin-form" style={{ maxWidth: "480px" }}>
          <label>
            Subject ID
            <input
              type="text"
              value={enrollSubjectId}
              onChange={(e) => setEnrollSubjectId(e.target.value)}
              placeholder="e.g. SUB_001"
            />
          </label>
          <label>
            Participant Name <span className="subtext">(optional override)</span>
            <input
              type="text"
              value={enrollParticipant}
              onChange={(e) => setEnrollParticipant(e.target.value)}
              placeholder="Uses subject's name if blank"
            />
          </label>
          <button type="submit" className="primary-btn">Generate Code</button>
          {generatedCode && (
            <div className="code-display">
              <p className="subtext">Give this code to the patient:</p>
              <p className="enrollment-code">{generatedCode}</p>
            </div>
          )}
          {enrollStatus && <p className={generatedCode ? "success-text" : "error-text"}>{enrollStatus}</p>}
        </form>
      </section>

      <section className="panel">
        <h2>Link Patient to Subject</h2>
        <p className="subtext">Connect a Cognito patient account to a subject record in the current study.</p>
        <form onSubmit={handleLink} className="admin-form" style={{ maxWidth: "480px" }}>
          <label>
            Patient Cognito Sub
            <input
              type="text"
              value={linkSub}
              onChange={(e) => setLinkSub(e.target.value)}
              placeholder="e.g. d1bbb550-7031-70e3-..."
            />
          </label>
          <label>
            Subject ID
            <input
              type="text"
              value={linkSubjectId}
              onChange={(e) => setLinkSubjectId(e.target.value)}
              placeholder="e.g. SUB_001"
            />
          </label>
          <button type="submit" className="primary-btn">Link Patient</button>
          {linkStatus && <p className={linkStatus.includes("success") ? "success-text" : "error-text"}>{linkStatus}</p>}
        </form>
      </section>
    </>
  );
}
