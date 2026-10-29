export const accountStatus = (user) =>
  user.status === 'pending'
    ? 'pending'
    : !user.active || user.status === 'deactivated'
      ? 'deactivated'
      : 'active';
export const serializeUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  cohort: user.cohort ? String(user.cohort) : null,
  active: user.active,
  status: accountStatus(user),
  invitationSentAt: user.invitationSentAt || null,
});
