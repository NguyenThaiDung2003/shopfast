import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import { Badge, Button, Card, Icon, Modal, Spinner, Textarea, useToast } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber, formatRelativeTime } from '../lib/format';
import { orderKeys } from '../orders/my-orders-api';
import { TICKET_POLL_MS, ticketKeys } from '../support/tickets-api';
import { OUTCOME_META, PENDING_TYPE_META, toolCallLabel, toolIcon } from './assistant-view';
import {
  askAssistant,
  consoleKeys,
  decidePendingAction,
  fetchPendingActions,
  type AssistantReply,
  type Decision,
  type PendingAction,
} from './console-api';
import {
  MAX_NOTE_LENGTH,
  MAX_QUESTION_LENGTH,
  validateDecisionNote,
  validateQuestion,
} from './console-filters';

interface Turn {
  id: number;
  question: string;
  state: 'pending' | 'done' | 'error';
  reply?: AssistantReply;
  error?: string;
}

const SUGGESTIONS = [
  'Tóm tắt yêu cầu của khách và đề xuất hướng xử lý',
  'Kiểm tra trạng thái đơn liên quan',
];

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: (question: string) => void }) {
  const outcome = turn.reply ? OUTCOME_META[turn.reply.outcome] : null;
  return (
    <li className="space-y-space-sm">
      <p className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-primary-fixed px-space-md py-space-sm text-body-md text-on-primary-fixed">
        {turn.question}
      </p>
      {turn.state === 'pending' && (
        <p className="flex items-center gap-space-sm text-body-sm text-on-surface-variant">
          <Spinner size="sm" label="" className="h-4 w-4" />
          Copilot đang tra cứu…
        </p>
      )}
      {turn.state === 'error' && (
        <div
          role="alert"
          className="space-y-space-sm rounded-xl bg-error-container/60 p-space-md text-body-sm text-on-error-container"
        >
          <p className="flex items-start gap-space-sm">
            <Icon name="error" className="text-lg" />
            {turn.error}
          </p>
          <Button size="sm" variant="outline" icon="refresh" onClick={() => onRetry(turn.question)}>
            Hỏi lại
          </Button>
        </div>
      )}
      {turn.reply && (
        <article
          aria-label="Trả lời của Copilot"
          className="space-y-space-sm rounded-xl bg-surface-container-low p-space-md"
        >
          {turn.reply.toolCalls.length > 0 && (
            <ul aria-label="Công cụ đã dùng" className="flex flex-wrap gap-space-xs">
              {turn.reply.toolCalls.map((call, index) => (
                <li
                  key={`${call.name}-${index}`}
                  className={cn(
                    'inline-flex items-center gap-space-xs rounded-full px-space-sm py-0.5 text-label-sm font-semibold',
                    call.ok
                      ? 'bg-tertiary-fixed text-on-tertiary-fixed'
                      : 'bg-error-container text-on-error-container',
                  )}
                >
                  <Icon name={call.ok ? 'check' : 'warning'} className="text-sm" />
                  <Icon name={toolIcon(call)} className="text-sm" />
                  {toolCallLabel(call)}
                </li>
              ))}
            </ul>
          )}
          {outcome && (
            <Badge tone={outcome.tone} icon="shield">
              {outcome.label}
            </Badge>
          )}
          <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
            {turn.reply.reply}
          </p>
          {turn.reply.pendingActions.length > 0 && (
            <p className="flex items-center gap-space-xs text-label-sm text-secondary">
              <Icon name="bolt" className="text-sm" />
              Đã tạo {turn.reply.pendingActions.length} đề xuất – xem mục bên dưới để duyệt.
            </p>
          )}
        </article>
      )}
    </li>
  );
}

function PendingActionCard({
  action,
  onDecide,
}: {
  action: PendingAction;
  onDecide: (action: PendingAction, decision: Decision) => void;
}) {
  const meta = PENDING_TYPE_META[action.type];
  return (
    <article
      aria-label={`Đề xuất: ${meta.label} ${action.orderCode}`}
      className="space-y-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-card"
    >
      <div className="flex items-start justify-between gap-space-sm">
        <h4 className="flex items-center gap-space-xs text-title-md text-secondary">
          <Icon name={meta.icon} className="text-xl" />
          {meta.label} #{action.orderCode}
        </h4>
        <span className="shrink-0 text-label-sm text-on-surface-variant">
          {formatRelativeTime(action.createdAt)}
        </span>
      </div>
      <p className="text-body-md text-on-surface">{action.summary}</p>
      {action.reason && (
        <p className="text-body-sm text-on-surface-variant">Lý do: {action.reason}</p>
      )}
      <p className="flex items-center gap-space-sm rounded-lg bg-secondary-fixed/50 px-space-md py-space-sm text-label-md text-on-secondary-fixed-variant">
        <Icon name="warning" className="text-lg" />
        Cần nhân viên xác nhận trước khi thực hiện
      </p>
      <div className="grid grid-cols-2 gap-space-sm">
        <Button variant="primary" icon="check_circle" onClick={() => onDecide(action, 'confirm')}>
          Xác nhận
        </Button>
        <Button variant="outline" icon="close" onClick={() => onDecide(action, 'reject')}>
          Từ chối
        </Button>
      </div>
    </article>
  );
}

function DecisionModal({
  action,
  decision,
  onClose,
}: {
  action: PendingAction;
  decision: Decision;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const meta = PENDING_TYPE_META[action.type];
  const confirming = decision === 'confirm';

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: consoleKeys.pendingAll });
    void queryClient.invalidateQueries({ queryKey: consoleKeys.queueAll });
    if (action.ticketId) {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(action.ticketId) });
    }
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(action.orderId) });
  };

  const decide = useMutation({
    mutationFn: () => decidePendingAction(action.id, decision, note.trim() || undefined),
    onSuccess: (result) => {
      refresh();
      onClose();
      toast.show(
        result.status === 'EXECUTED'
          ? { tone: 'success', title: `Đã thực hiện: ${meta.label} #${action.orderCode}` }
          : result.status === 'REJECTED'
            ? { tone: 'info', title: `Đã từ chối đề xuất ${meta.label} #${action.orderCode}` }
            : { tone: 'warning', title: 'Đề xuất chưa hoàn tất, vui lòng kiểm tra lại.' },
      );
    },
    onError: (err) => {
      toast.show({
        tone: 'error',
        title: confirming ? 'Không thực hiện được đề xuất' : 'Không từ chối được đề xuất',
        description: errorMessage(err),
      });
      // Đề xuất đã được xử lý/không còn hợp lệ → tải lại và đóng; lỗi tạm thời thì giữ để thử lại.
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        refresh();
        onClose();
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateDecisionNote(note);
    setError(invalid);
    if (!invalid) decide.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!decide.isPending}
      icon={confirming ? 'check_circle' : 'block'}
      title={
        confirming
          ? `Xác nhận ${meta.label.toLowerCase()} #${action.orderCode}?`
          : 'Từ chối đề xuất?'
      }
      subtitle={
        confirming
          ? 'Thao tác sẽ được thực hiện ngay và không tự hoàn tác.'
          : 'Không có thay đổi nào được thực hiện trên đơn hàng.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={decide.isPending}>
            Huỷ bỏ
          </Button>
          <Button
            type="submit"
            form={`decision-${action.id}`}
            variant={confirming ? 'primary' : 'danger'}
            loading={decide.isPending}
          >
            {confirming ? 'Xác nhận thực hiện' : 'Từ chối đề xuất'}
          </Button>
        </>
      }
    >
      <form id={`decision-${action.id}`} onSubmit={submit} noValidate className="space-y-space-md">
        <p className="text-body-md text-on-surface">{action.summary}</p>
        <Textarea
          label="Ghi chú (không bắt buộc)"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(undefined);
          }}
          error={error}
          counterMax={MAX_NOTE_LENGTH}
          rows={3}
          placeholder="Lý do xác nhận / từ chối để đồng nghiệp tra cứu sau"
        />
      </form>
    </Modal>
  );
}

/** Cột phải "ShopFast Copilot": hỏi trợ lý AI về ticket đang mở + duyệt đề xuất của nó. */
export function CopilotPanel({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const [turnsByTicket, setTurnsByTicket] = useState<Record<string, Turn[]>>({});
  const [question, setQuestion] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [aiDown, setAiDown] = useState(false);
  const [deciding, setDeciding] = useState<{ action: PendingAction; decision: Decision }>();
  const nextId = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);
  const turns = turnsByTicket[ticketId] ?? [];

  const pending = useQuery({
    queryKey: consoleKeys.pending(ticketId),
    queryFn: ({ signal }) => fetchPendingActions(ticketId, signal),
    refetchInterval: TICKET_POLL_MS,
  });

  const patchTurn = (forTicket: string, id: number, patch: Partial<Turn>) =>
    setTurnsByTicket((prev) => ({
      ...prev,
      [forTicket]: (prev[forTicket] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  const ask = useMutation({
    mutationFn: (vars: { ticketId: string; turnId: number; question: string }) =>
      askAssistant(vars.ticketId, vars.question),
    onSuccess: (reply, vars) => {
      setAiDown(false);
      patchTurn(vars.ticketId, vars.turnId, { state: 'done', reply });
      void queryClient.invalidateQueries({ queryKey: consoleKeys.pending(vars.ticketId) });
    },
    onError: (error, vars) => {
      if (isApiError(error) && error.code === 'AI_UNAVAILABLE') setAiDown(true);
      patchTurn(vars.ticketId, vars.turnId, { state: 'error', error: errorMessage(error) });
    },
  });

  const send = (text: string) => {
    if (ask.isPending) return;
    const invalid = validateQuestion(text);
    setInputError(invalid);
    if (invalid) return;
    const turn: Turn = { id: nextId.current++, question: text.trim(), state: 'pending' };
    setTurnsByTicket((prev) => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), turn] }));
    setQuestion('');
    ask.mutate({ ticketId, turnId: turn.id, question: turn.question });
  };

  const lastState = turns.at(-1)?.state;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastState]);

  const status = ask.isPending
    ? { label: 'Đang tra cứu…', className: 'bg-secondary-fixed text-on-secondary-fixed' }
    : aiDown
      ? { label: 'AI tạm ngưng', className: 'bg-error-container text-on-error-container' }
      : { label: 'Sẵn sàng', className: 'bg-tertiary-fixed text-on-tertiary-fixed' };

  const actions = pending.data?.items ?? [];

  return (
    <section aria-label="ShopFast Copilot" className="flex flex-col gap-space-md">
      <Card className="flex flex-col gap-space-md p-space-md">
        <header className="flex items-center gap-space-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary">
            <Icon name="smart_toy" className="text-xl" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-space-sm text-title-md text-primary">
              ShopFast Copilot
              <span
                role="status"
                className={cn('rounded-full px-space-sm py-0.5 text-label-sm', status.className)}
              >
                {status.label}
              </span>
            </h2>
            <p className="text-label-sm text-on-surface-variant">
              Tra cứu đơn/tồn kho bằng dữ liệu thật; thao tác ghi chỉ là đề xuất.
            </p>
          </div>
        </header>

        <div ref={threadRef} className="max-h-[420px] overflow-y-auto">
          {turns.length === 0 ? (
            <div className="space-y-space-sm rounded-xl bg-surface-container-low p-space-md">
              <p className="flex items-center gap-space-sm text-title-sm text-primary">
                <Icon name="psychology" className="text-lg" />
                Hỏi Copilot về ticket này
              </p>
              <p className="text-body-sm text-on-surface-variant">
                Copilot đọc hội thoại của ticket, tự tra đơn hàng và tồn kho khi cần. Lịch sử hỏi
                đáp chỉ lưu trong phiên làm việc này.
              </p>
              <div className="flex flex-wrap gap-space-xs">
                {SUGGESTIONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => send(text)}
                    disabled={ask.isPending}
                    className="rounded-full bg-surface-container-lowest px-space-md py-space-xs text-label-md text-primary shadow-card hover:bg-primary-fixed disabled:opacity-50"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol aria-label="Hỏi đáp với Copilot" className="space-y-space-lg">
              {turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} onRetry={send} />
              ))}
            </ol>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(question);
          }}
          noValidate
        >
          <div
            className={cn(
              'flex items-center gap-space-sm rounded-xl bg-surface-container-low py-space-xs pl-space-md pr-space-xs focus-within:ring-2',
              inputError ? 'ring-2 ring-error' : 'focus-within:ring-primary',
            )}
          >
            <Icon name="auto_awesome" className="text-lg text-primary" />
            <input
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setInputError(undefined);
              }}
              aria-label="Câu hỏi cho Copilot"
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? 'copilot-question-error' : undefined}
              placeholder="Hỏi Copilot hoặc yêu cầu soạn mẫu trả lời…"
              className="h-10 min-w-0 flex-1 bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
            />
            <Button
              type="submit"
              variant="brand"
              size="sm"
              aria-label="Hỏi Copilot"
              loading={ask.isPending}
              icon="arrow_forward"
            />
          </div>
          {inputError && (
            <p id="copilot-question-error" className="mt-space-xs text-body-sm text-error">
              {inputError}
            </p>
          )}
          <p className="mt-space-xs text-right text-label-sm text-outline">
            Tối đa {formatNumber(MAX_QUESTION_LENGTH)} ký tự
          </p>
        </form>
      </Card>

      <Card className="flex flex-col gap-space-md bg-surface-container-low p-space-md">
        <h3 className="flex items-center gap-space-sm text-title-md text-secondary">
          <Icon name="bolt" className="text-xl" />
          Đề xuất chờ duyệt
          {actions.length > 0 && (
            <span className="rounded-full bg-secondary-container px-space-sm text-label-sm text-on-secondary">
              {actions.length}
            </span>
          )}
        </h3>
        {pending.isPending ? (
          <p
            role="status"
            className="flex items-center gap-space-sm text-body-sm text-on-surface-variant"
          >
            <Spinner size="sm" label="" className="h-4 w-4" />
            Đang tải đề xuất…
          </p>
        ) : pending.isError ? (
          <div className="space-y-space-sm text-body-sm text-on-surface-variant">
            <p>Không tải được đề xuất: {errorMessage(pending.error)}</p>
            <Button
              size="sm"
              variant="outline"
              icon="refresh"
              onClick={() => void pending.refetch()}
            >
              Thử lại
            </Button>
          </div>
        ) : actions.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Chưa có đề xuất nào. Khi Copilot đề xuất huỷ đơn hoặc đổi trả, đề xuất sẽ chờ bạn duyệt
            ở đây.
          </p>
        ) : (
          <div className="space-y-space-sm">
            {actions.map((action) => (
              <PendingActionCard
                key={action.id}
                action={action}
                onDecide={(a, decision) => setDeciding({ action: a, decision })}
              />
            ))}
          </div>
        )}
      </Card>

      {deciding && (
        <DecisionModal
          action={deciding.action}
          decision={deciding.decision}
          onClose={() => setDeciding(undefined)}
        />
      )}
    </section>
  );
}
