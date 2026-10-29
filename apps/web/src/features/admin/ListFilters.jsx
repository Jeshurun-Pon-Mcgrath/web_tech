import { Button, Select, Input } from '../../components/ui';
import { ResourceSelect } from '../../components/ui/ResourcePicker';
import { QUESTION_LABELS } from '@examledger/contracts';
const sorts = {
  students: ['createdAt', 'name', 'email'],
  questions: ['createdAt', 'prompt', 'points', 'revision', 'topic', 'difficulty'],
  exams: ['createdAt', 'title', 'opensAt', 'closesAt'],
  results: ['createdAt', 'title', 'closesAt'],
  attempts: ['createdAt', 'deadline', 'score', 'submittedAt'],
  integrity: ['createdAt', 'reviewStatus', 'deadline'],
  assignments: ['createdAt', 'attemptsUsed'],
  cohorts: ['createdAt', 'name'],
  subjects: ['createdAt', 'name', 'code'],
};
const sortLabels = {
  createdAt: 'Date created',
  name: 'Name',
  email: 'Email',
  prompt: 'Question',
  points: 'Points',
  title: 'Title',
  opensAt: 'Opening time',
  closesAt: 'Closing time',
  deadline: 'Deadline',
  score: 'Score',
  submittedAt: 'Submission time',
  reviewStatus: 'Review status',
  attemptsUsed: 'Attempts used',
  code: 'Code',
  revision: 'Version',
  topic: 'Topic',
  difficulty: 'Difficulty',
};
export default function ListFilters({ section, list }) {
  const select = (field, label, choices) => (
    <Select
      label={label}
      value={list.query.get(field) || ''}
      onChange={(e) => list.update(field, e.target.value)}
    >
      <option value="">All</option>
      {Object.entries(choices).map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="list-filters">
      {section === 'students' && (
        <>
          {select('accountStatus', 'Account status', {
            active: 'Active',
            pending: 'Pending',
            deactivated: 'Deactivated',
          })}
          <ResourceSelect
            resource="cohorts"
            label="Filter by cohort"
            value={list.query.get('cohort')}
            onChange={(id) => list.update('cohort', id)}
          />
        </>
      )}
      {section === 'questions' && (
        <>
          <Input
            label="Filter by topic"
            value={list.query.get('topic') || ''}
            maxLength={120}
            onChange={(event) => list.update('topic', event.target.value, true)}
          />
          <Input
            label="Filter by tag"
            value={list.query.get('tag') || ''}
            maxLength={40}
            onChange={(event) => list.update('tag', event.target.value, true)}
          />
          {select('difficulty', 'Filter difficulty', {
            unspecified: 'Unspecified',
            easy: 'Easy',
            medium: 'Medium',
            hard: 'Hard',
          })}
          {select('type', 'Question type', QUESTION_LABELS)}
          {select('archived', 'Question status', { false: 'Available', true: 'Archived' })}
        </>
      )}
      {['questions', 'exams', 'results'].includes(section) && (
        <ResourceSelect
          resource="subjects"
          label="Filter by subject"
          value={list.query.get('subject')}
          onChange={(id) => list.update('subject', id)}
        />
      )}
      {['exams', 'results'].includes(section) &&
        select('status', 'Publication status', { draft: 'Draft', published: 'Published' })}
      {['exams', 'results'].includes(section) &&
        select('archived', 'Exam archive status', { false: 'Not archived', true: 'Archived' })}
      {section === 'results' &&
        select('released', 'Result release', { true: 'Released', false: 'Not released' })}
      {['attempts', 'integrity'].includes(section) &&
        select('status', 'Attempt status', { active: 'In progress', submitted: 'Submitted' })}
      {['attempts', 'integrity', 'assignments'].includes(section) && (
        <>
          <ResourceSelect
            resource="exams"
            label="Filter by exam"
            value={list.query.get('exam')}
            onChange={(id) => list.update('exam', id)}
          />
          <ResourceSelect
            resource="students"
            label="Filter by student"
            value={list.query.get('student')}
            onChange={(id) => list.update('student', id)}
          />
        </>
      )}
      {section === 'integrity' && (
        <>
          {select('reviewStatus', 'Review status', {
            pending: 'Pending',
            cleared: 'Cleared',
            flagged: 'Flagged',
          })}
          {select('hasEvents', 'Integrity signals', { true: 'Has signals', false: 'No signals' })}
        </>
      )}
      <Select
        label="Sort by"
        value={list.query.get('sort') || 'createdAt'}
        onChange={(e) => list.update('sort', e.target.value)}
      >
        {(sorts[section] || ['createdAt']).map((value) => (
          <option value={value} key={value}>
            {sortLabels[value]}
          </option>
        ))}
      </Select>
      <Select
        label="Sort direction"
        value={list.query.get('order') || 'desc'}
        onChange={(e) => list.update('order', e.target.value)}
      >
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </Select>
      <Button type="button" variant="text" onClick={list.clear}>
        Clear filters
      </Button>
    </div>
  );
}
