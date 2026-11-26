import { useEffect, useRef } from 'react';
import { Logo } from '../club/Logo.tsx';
import s from './MemberCard.module.css';

const TILT = ['--rx', '--ry', '--gx', '--gy'] as const;

/** The member's card. It follows the pointer, as a card held to the light would, where hover and motion allow. */
export function MemberCard({ name, number, role = 'Member' }: { name: string; number: string; role?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = stage.current;
    const face = card.current;
    if (!area || !face || !matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
    const move = (event: PointerEvent) => {
      const r = face.getBoundingClientRect();
      const px = Math.min(Math.max((event.clientX - r.left) / r.width, 0), 1);
      const py = Math.min(Math.max((event.clientY - r.top) / r.height, 0), 1);
      face.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
      face.style.setProperty('--rx', `${(0.5 - py) * 12}deg`);
      face.style.setProperty('--gx', `${px * 100}%`);
      face.style.setProperty('--gy', `${py * 100}%`);
    };
    const leave = () => {
      for (const property of TILT) face.style.removeProperty(property);
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerleave', leave);
    return () => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div className={s.stage} ref={stage}>
      <div className="member" ref={card}>
        <Logo brand="club" />
        <span></span>
        <div className="who">
          <div>
            <span>{role}</span>
            <b data-card-name="">{name}</b>
          </div>
          <div className="no">
            <span>No.</span>
            <br />
            {number}
          </div>
        </div>
      </div>
    </div>
  );
}
