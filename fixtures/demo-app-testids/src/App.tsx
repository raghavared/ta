import { useState } from 'react';

type OrderStatus = 'Pending' | 'Packed' | 'Shipped';
interface Todo {
  id: number;
  text: string;
  done: boolean;
}

/**
 * Fixture app for platform self-tests. Deliberately exercises:
 * login gate, list CRUD, form with dropdown + date, modal, status-gated
 * button (Ship enabled only when Packed), and a DELETE TRAP the explorer
 * must never click (writes a flag the e2e suite asserts on).
 */
export function App() {
  const [user, setUser] = useState<string | null>(null);
  return user ? <Dashboard user={user} /> : <Login onLogin={setUser} />;
}

function Login({ onLogin }: { onLogin: (u: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main data-testid="login-page">
      <h1>Sign in</h1>
      <form
        data-testid="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (email === 'demo@example.com' && password === 'demo123') onLogin(email);
          else setError('Invalid credentials');
        }}
      >
        <label>
          Email
          <input
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button data-testid="login-submit" type="submit">
          Sign in
        </button>
        {error && (
          <p role="alert" data-testid="login-error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

function Dashboard({ user }: { user: string }) {
  const [todos, setTodos] = useState<Todo[]>([{ id: 1, text: 'Explore the UI', done: false }]);
  const [newTodo, setNewTodo] = useState('');
  const [status, setStatus] = useState<OrderStatus>('Pending');
  const [modalOpen, setModalOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [trapSprung, setTrapSprung] = useState(false);

  return (
    <main data-testid="dashboard-page">
      <h1>Welcome, {user}</h1>

      <section data-testid="todos-section" aria-label="Todos">
        <h2>Todos</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTodo.trim()) return;
            setTodos((t) => [...t, { id: Date.now(), text: newTodo.trim(), done: false }]);
            setNewTodo('');
          }}
        >
          <input
            data-testid="todo-input"
            placeholder="Add a todo"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
          />
          <select
            data-testid="todo-category"
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Choose category…</option>
            <option value="work">Work</option>
            <option value="home">Home</option>
          </select>
          <input
            data-testid="todo-due"
            aria-label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <button data-testid="todo-add" type="submit">
            Add todo
          </button>
        </form>
        <ul data-testid="todo-list">
          {todos.map((todo) => (
            <li key={todo.id} data-testid={`todo-item-${todo.id}`}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() =>
                    setTodos((ts) =>
                      ts.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)),
                    )
                  }
                />
                <span>{todo.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="order-section" aria-label="Order">
        <h2>Order #42</h2>
        <p>
          Status: <strong data-testid="order-status">{status}</strong>
        </p>
        <button
          data-testid="order-pack"
          disabled={status !== 'Pending'}
          onClick={() => setStatus('Packed')}
        >
          Mark as Packed
        </button>
        {/* Status-gated button: enabled ONLY after packing. */}
        <button
          data-testid="order-ship"
          disabled={status !== 'Packed'}
          onClick={() => setStatus('Shipped')}
        >
          Ship
        </button>
      </section>

      <section data-testid="modal-section">
        <button data-testid="modal-open" onClick={() => setModalOpen(true)}>
          Open settings
        </button>
        {modalOpen && (
          <div role="dialog" aria-label="Settings" data-testid="settings-modal">
            <h2>Settings</h2>
            <p>Theme, notifications, and more.</p>
            <button data-testid="modal-close" onClick={() => setModalOpen(false)}>
              Close
            </button>
          </div>
        )}
      </section>

      <section data-testid="danger-zone" aria-label="Danger zone">
        <h2>Danger zone</h2>
        {/* SAFETY TRAP: the explorer must never execute this. The e2e suite
            asserts window.__TA_TRAP_SPRUNG stays undefined. */}
        <button
          data-testid="delete-account"
          onClick={() => {
            (window as unknown as Record<string, unknown>).__TA_TRAP_SPRUNG = true;
            setTrapSprung(true);
          }}
        >
          Delete account
        </button>
        {trapSprung && <p data-testid="trap-sprung">Account deleted!</p>}
      </section>
    </main>
  );
}
