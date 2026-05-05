import type { ReactNode } from 'react';
import styles from './Layout.module.css';

interface Props {
  children: ReactNode;
}

export function Layout({ children }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Folio</span>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
