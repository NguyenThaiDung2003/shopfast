import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { OtpInput } from './OtpInput';

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <OtpInput value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

const box = (n: number) => screen.getByRole('textbox', { name: `Chữ số ${n}` });

describe('OtpInput', () => {
  it('gõ tự nhảy ô, bỏ ký tự không phải số', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box(1));
    await user.keyboard('1a2');
    expect(screen.getByRole('status')).toHaveTextContent('12');
    expect(box(3)).toHaveFocus();
  });

  it('Backspace xoá và lùi ô; mũi tên di chuyển', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box(1));
    await user.keyboard('123{Backspace}');
    expect(screen.getByRole('status')).toHaveTextContent('12');
    expect(box(3)).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(box(2)).toHaveFocus();
  });

  it('dán mã có ký tự thừa → chỉ lấy 6 chữ số', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box(1));
    await user.paste('12-34 5678');
    expect(screen.getByRole('status')).toHaveTextContent('123456');
    expect(box(6)).toHaveFocus();
  });
});
