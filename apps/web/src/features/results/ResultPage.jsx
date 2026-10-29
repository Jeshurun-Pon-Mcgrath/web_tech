import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Printer } from 'lucide-react';
import { useResource } from '../../hooks/useResource';
import { Badge, Button, ErrorMessage, Loading, PageHeading } from '../../components/ui';
import { formatDate } from '../../lib/api';
export default function ResultPage() {
  const { id } = useParams();
  const { data, loading, error, refresh } = useResource(`/student/attempts/${id}/result`);
  if (loading) return <Loading />;
  if (!data)
    return (
      <>
        <ErrorMessage error={error} />
        <Button onClick={refresh}>Check again</Button>
      </>
    );
  return (
    <>
      <Link className="inline-link back-link" to="/student/results">
        <ArrowLeft size={16} />
        Back to results
      </Link>
      <PageHeading
        eyebrow="RELEASED RESULT"
        title={data.title}
        description={`Attempt ${data.number} · Submitted ${formatDate(data.submittedAt)}`}
        action={
          <Button variant="secondary" className="no-print" onClick={() => window.print()}>
            <Printer size={16} />
            Print released result
          </Button>
        }
      />
      <section className="result-summary panel">
        <div>
          <p className="eyebrow">YOUR SCORE</p>
          <strong>
            {data.score}
            <span> / {data.maxScore}</span>
          </strong>
        </div>
        <div>
          <span className="result-percentage">{data.percentage}%</span>
          <p className="muted">
            {data.questions.filter((q) => q.correct).length} of {data.questions.length} questions
            correct
          </p>
        </div>
        <Badge tone="teal">Result released</Badge>
      </section>
      <div className="section-heading">
        <h2>Review your answers</h2>
      </div>
      {data.questions.map((q, i) => (
        <section key={q.id} className="panel answer-review">
          <div className="question-heading">
            <p className="eyebrow">QUESTION {i + 1}</p>
            <Badge tone={q.correct ? 'teal' : 'danger'}>
              {q.awardedPoints} / {q.points} points
            </Badge>
          </div>
          <h3>{q.prompt}</h3>
          <div className="review-choices">
            {q.choices.map((c, choiceIndex) => (
              <div
                className={`${q.correctChoiceIds.includes(c.id) ? 'correct' : ''} ${q.selectedChoiceIds.includes(c.id) && !q.correctChoiceIds.includes(c.id) ? 'incorrect' : ''}`}
                key={c.id}
              >
                <span>{String.fromCharCode(65 + choiceIndex)}.</span>
                {c.text}
                {q.correctChoiceIds.includes(c.id) && (
                  <span className="choice-annotation">
                    <Check size={16} />
                    Correct answer
                  </span>
                )}
                {q.selectedChoiceIds.includes(c.id) && (
                  <span className="choice-annotation">Your answer</span>
                )}
              </div>
            ))}
          </div>
          {!q.selectedChoiceIds.length && <p className="muted small">No answer submitted.</p>}
          {q.penalty > 0 && (
            <p className="muted small">
              Incorrect-answer penalty: {q.penalty} points. Unanswered: zero. No partial credit.
            </p>
          )}
          {q.explanation && (
            <div className="explanation">
              <strong>Explanation</strong>
              <p>{q.explanation}</p>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
