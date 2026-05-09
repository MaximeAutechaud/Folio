import type { ReactNode } from 'react';
import styles from './Layout.module.css';

interface Props {
  children: ReactNode;
  nav?: ReactNode;
}

export function Layout({ children, nav }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Folio</span>
        {nav && <nav className={styles.nav}>{nav}</nav>}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
