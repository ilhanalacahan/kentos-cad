//! Failed sign-in limit (docs/adr/0007): after `MAX_FAILURES` wrong
//! passwords for one login within `WINDOW`, that login is refused for the
//! rest of the window without checking the password (429). A success clears
//! the count. Kept in this process's memory: a restart forgets it, and
//! several server processes would each count on their own (noted in ADR 0007).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MAX_FAILURES: u32 = 5;
pub const WINDOW: Duration = Duration::from_secs(15 * 60);
/// Old entries are swept when the map grows past this.
const SWEEP_AT: usize = 10_000;

#[derive(Default)]
pub struct LoginLimiter {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl LoginLimiter {
    fn key(login: &str) -> String {
        login.trim().to_lowercase()
    }

    /// Seconds until this login may try again, or None when it may try now.
    pub fn blocked(&self, login: &str) -> Option<u64> {
        let map = self.failures.lock().expect("limiter lock");
        let (count, since) = map.get(&Self::key(login))?;
        let left = WINDOW.checked_sub(since.elapsed())?;
        (*count >= MAX_FAILURES).then(|| left.as_secs().max(1))
    }

    pub fn failed(&self, login: &str) {
        let mut map = self.failures.lock().expect("limiter lock");
        if map.len() > SWEEP_AT {
            map.retain(|_, (_, since)| since.elapsed() < WINDOW);
        }
        let entry = map.entry(Self::key(login)).or_insert((0, Instant::now()));
        if entry.1.elapsed() >= WINDOW {
            *entry = (0, Instant::now());
        }
        entry.0 += 1;
    }

    pub fn succeeded(&self, login: &str) {
        self.failures
            .lock()
            .expect("limiter lock")
            .remove(&Self::key(login));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_a_login_after_repeated_failures_and_forgets_on_success() {
        let l = LoginLimiter::default();
        for _ in 0..MAX_FAILURES - 1 {
            l.failed("Ayse");
        }
        assert_eq!(l.blocked("ayse"), None);
        l.failed(" AYSE ");
        assert!(
            l.blocked("ayse")
                .is_some_and(|s| s > 0 && s <= WINDOW.as_secs())
        );
        // Another login is not affected.
        assert_eq!(l.blocked("mehmet"), None);
        l.succeeded("ayse");
        assert_eq!(l.blocked("ayse"), None);
    }
}
