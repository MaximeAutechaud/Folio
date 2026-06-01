import type { ReactNode } from 'react';
import styles from './Layout.module.css';

interface Props {
  children: ReactNode;
  nav?: ReactNode;
  actions?: ReactNode;
}

export function Layout({ children, nav, actions }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Folio</span>
        {nav && <nav className={styles.nav}>{nav}</nav>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
