import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Avatar, avatarColor, Badge, Banner, Button, Card, CardHeader, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogTrigger,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Field,
  IconButton, initials, Input, Kbd, LockedFeature, Meter, PasswordStrength, Popover, PopoverContent, PopoverTrigger, Select, Separator,
  Skeleton, Spinner, Switch, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast, Toaster, Tooltip, TooltipProvider,
} from '../src/index.js';

describe('Button', () => {
  it('defaults to type=button and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('type', 'button');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('loading disables and marks busy', () => {
    render(<Button loading>Go</Button>);
    const b = screen.getByRole('button', { name: /Go/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('asChild renders the child element', () => {
    render(<Button asChild><a href="/x">Link</a></Button>);
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute('href', '/x');
  });
  it('IconButton has an accessible name', () => {
    render(<IconButton label="Close panel" icon={<span>x</span>} />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
  });
});

describe('form controls', () => {
  it('Field wires label, hint and error', () => {
    const { rerender } = render(<Field label="Email" hint="We never share it"><Input /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('We never share it');
    rerender(<Field label="Email" error="Required" optional><Input /></Field>);
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
  it('Textarea, Select, Checkbox and Switch work', async () => {
    const onCheck = vi.fn();
    const onSwitch = vi.fn();
    render(
      <>
        <Textarea aria-label="Bio" />
        <Select aria-label="Pick"><option>a</option></Select>
        <Checkbox aria-label="Agree" onCheckedChange={onCheck} />
        <Switch aria-label="Dark" onCheckedChange={onSwitch} />
        <SwitchRow label="Notify" description="By email" />
      </>,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agree' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Dark' }));
    expect(onCheck).toHaveBeenCalledWith(true);
    expect(onSwitch).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Notify' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bio' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Pick' })).toBeInTheDocument();
  });
  it('PasswordStrength renders label and nothing when null', () => {
    const { container, rerender } = render(<PasswordStrength score={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PasswordStrength score={3} warning="Add a word" />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText(/Add a word/)).toBeInTheDocument();
  });
});

describe('feedback', () => {
  it('Meter exposes value semantics', () => {
    render(<Meter value={12} max={15} label="Sandbox storage" format={(n) => `${n} GB`} />);
    const m = screen.getByRole('meter', { name: 'Sandbox storage' });
    expect(m).toHaveAttribute('aria-valuenow', '12');
    expect(m).toHaveAttribute('aria-valuetext', '12 GB of 15 GB');
  });
  it('Banner is dismissible and critical uses role=alert', async () => {
    const onDismiss = vi.fn();
    render(<Banner tone="critical" title="Down" onDismiss={onDismiss} action={<Button>Retry</Button>}>Provider outage</Banner>);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider outage');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
  it('renders misc components', () => {
    render(
      <>
        <Spinner />
        <Skeleton className="h-4" />
        <Badge tone="accent">Beta</Badge>
        <Card><CardHeader title="Title" description="Desc" action={<span>a</span>} /></Card>
        <EmptyState icon={<span>i</span>} title="Nothing here" description="Start a chat" action={<Button>New</Button>} />
        <LockedFeature title="Code Mode" reason="Verify your email" />
        <Kbd>⌘K</Kbd>
        <Separator />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Verify your email')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('computes initials and stable colors', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  cher ')).toBe('C');
    expect(initials('')).toBe('?');
    expect(initials('Émile Zola')).toBe('ÉZ');
    expect(avatarColor('x')).toBe(avatarColor('x'));
  });
  it('falls back to initials when the image fails', async () => {
    const { container } = render(<Avatar src="/broken.png" name="Ada Lovelace" />);
    const img = container.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(screen.getByText('AL')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });
});

describe('overlays', () => {
  it('Dialog opens with title and closes', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
        <DialogContent title="Settings" description="Change things">body</DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('ConfirmDialog requires typed confirmation for destructive actions', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete all chats?" description="Cannot be undone" destructive confirmText="DELETE" confirmLabel="Delete" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'DELETE');
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it('DropdownMenu, Popover, Tabs and Tooltip render', async () => {
    const onSelect = vi.fn();
    render(
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button>Menu</Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild><Button>Pop</Button></PopoverTrigger>
          <PopoverContent>Popover body</PopoverContent>
        </Popover>
        <Tabs defaultValue="a">
          <TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList>
          <TabsContent value="a">Tab A</TabsContent>
          <TabsContent value="b">Tab B</TabsContent>
        </Tabs>
        <Tooltip content="Hint"><button type="button">Hover</button></Tooltip>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Pop' }));
    expect(await screen.findByText('Popover body')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('Tab B')).toBeVisible();
  });
});

describe('toast', () => {
  it('shows, supports actions and dismisses', async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.success('Saved', 'All good');
      toast({ title: 'Chat deleted', action: { label: 'Undo', onClick: undo } });
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
    const id = toast.error('Failed');
    act(() => toast.dismiss(id));
    await waitFor(() => expect(screen.queryByText('Failed')).not.toBeInTheDocument());
  });
});
