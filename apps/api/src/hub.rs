//! "Project changed" signals inside this process. They carry no data: each
//! subscriber reads its events from the outbox with its own access scope,
//! so the database stays the one source of truth and every push is
//! authorized per connection. Commits made elsewhere (another server
//! process, the CLI) are picked up by the subscribers' periodic check.

use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<(Uuid, Uuid)>,
}

impl Default for Hub {
    fn default() -> Self {
        Self {
            tx: broadcast::channel(1024).0,
        }
    }
}

impl Hub {
    /// A commit landed in `(tenant, project)`.
    pub fn notify(&self, tenant: Uuid, project: Uuid) {
        let _ = self.tx.send((tenant, project));
    }

    pub fn subscribe(&self) -> broadcast::Receiver<(Uuid, Uuid)> {
        self.tx.subscribe()
    }
}
