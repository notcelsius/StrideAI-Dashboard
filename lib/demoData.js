export const demoPIs = [
  {
    piId: "PI_1001",
    piName: "Dr. Eric Henricson",
    email: "eric.henricson@ucdavis.edu",
    password: "stride123",
    projects: [
      {
        projectId: "STUDY_001",
        projectName: "ADHD Mobility Study",
        subjects: [
          { subjectId: "SUB_001", participantName: "Participant 001", status: "Active", lastUpload: "2026-01-20" },
          { subjectId: "SUB_002", participantName: "Participant 002", status: "Active", lastUpload: "2026-01-22" },
          { subjectId: "SUB_003", participantName: "Participant 003", status: "Paused", lastUpload: "2026-01-17" }
        ]
      },
      {
        projectId: "STUDY_002",
        projectName: "Sleep and Location Patterns",
        subjects: [
          { subjectId: "SUB_004", participantName: "Participant 004", status: "Active", lastUpload: "2026-01-24" },
          { subjectId: "SUB_005", participantName: "Participant 005", status: "Completed", lastUpload: "2026-01-18" }
        ]
      }
    ]
  },
  {
    piId: "PI_2001",
    piName: "Dr. Jordan Lee",
    email: "jordan.lee@ucdavis.edu",
    password: "stride456",
    projects: [
      {
        projectId: "STUDY_101",
        projectName: "Campus Transit Behavior",
        subjects: [
          { subjectId: "SUB_101", participantName: "Participant 101", status: "Active", lastUpload: "2026-01-25" },
          { subjectId: "SUB_102", participantName: "Participant 102", status: "Active", lastUpload: "2026-01-23" }
        ]
      },
      {
        projectId: "STUDY_102",
        projectName: "Routine Stability Pilot",
        subjects: [
          { subjectId: "SUB_103", participantName: "Participant 103", status: "Paused", lastUpload: "2026-01-15" }
        ]
      }
    ]
  }
];
