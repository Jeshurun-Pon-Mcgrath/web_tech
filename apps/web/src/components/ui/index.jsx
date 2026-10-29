import { cloneElement, useEffect, useId, useRef } from 'react';
import { AlertCircle, BookOpen, X, LoaderCircle, Inbox } from 'lucide-react';
export function Brand({ light = false }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">
        <BookOpen size={23} aria-hidden="true" />
      </span>
      <span>
        ExamLedger<small>ACADEMIC ASSESSMENT</small>
      </span>
    </div>
  );
}
export function Button({
  children,
  variant = 'primary',
  busy,
  disabled,
  className = '',
  ...props
}) {
  return (
    <button
      className={`button button-${variant} ${className}`}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function Field({ label, children, hint }) {
  const generatedId = useId();
  const controlId = children.props.id || generatedId;
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {cloneElement(children, {
        id: controlId,
        ...(hint ? { 'aria-describedby': `${controlId}-hint` } : {}),
      })}
      {hint && <small id={`${controlId}-hint`}>{hint}</small>}
    </div>
  );
}
export function Input({ label, hint, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <input {...props} />
    </Field>
  );
}
export function Select({ label, children, ...props }) {
  return (
    <Field label={label}>
      <select {...props}>{children}</select>
    </Field>
  );
}
export function Textarea({ label, ...props }) {
  return (
    <Field label={label}>
      <textarea rows={3} {...props} />
    </Field>
  );
}
export function ErrorMessage({ error }) {
  return error ? (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>
        {typeof error === 'string' ? error : error.message}
        {error.details?.map((d, i) => (
          <small className="block" key={i}>
            {d.field}: {d.message}
          </small>
        ))}
      </span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" /> Loading your workspace…
    </div>
  );
}
export function Empty({ title = 'Nothing here yet', children }) {
  return (
    <div className="empty">
      <Inbox size={30} strokeWidth={1.3} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow || 'EXAMLEDGER WORKSPACE'}</p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Table({ columns, rows, empty = 'No records to display.' }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    const returnFocus = document.activeElement;
    d.showModal();
    return () => {
      d.close();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
        returnFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
