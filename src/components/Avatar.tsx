import { avatarHue, initials } from '../model/format';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const hue = avatarHue(name);
  return (
    <span
      className={`crm-avatar${large ? ' crm-avatar-lg' : ''}`}
      style={{ background: `hsl(${hue} 42% 42%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
