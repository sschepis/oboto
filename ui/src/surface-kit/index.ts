// Surface Kit — Pre-built component library for surface sandbox
// All components are exposed via the `UI` global inside surface components

// Layout
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './layout/Card';
import { Separator } from './layout/Separator';
import { Stack } from './layout/Stack';
import { ScrollArea } from './layout/ScrollArea';

// Primitives
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { TextArea } from './primitives/TextArea';
import { Label } from './primitives/Label';
import { Select, SelectItem } from './primitives/Select';
import { Checkbox } from './primitives/Checkbox';
import { Switch } from './primitives/Switch';
import { Slider } from './primitives/Slider';

// Navigation
import { Tabs, TabsList, TabsTrigger, TabsContent } from './navigation/Tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './navigation/Accordion';

// Overlay
import { Dialog } from './overlay/Dialog';
import { Popover } from './overlay/Popover';
import { Tooltip } from './overlay/Tooltip';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from './overlay/DropdownMenu';

// Data
import { Badge } from './data/Badge';
import { Table } from './data/Table';
import { Avatar } from './data/Avatar';
import { Progress } from './data/Progress';
import { Skeleton } from './data/Skeleton';

// Feedback
import { Alert } from './feedback/Alert';
import { toast } from './feedback/Toast';

// Charts
import { LineChart } from './charts/LineChart';
import { BarChart } from './charts/BarChart';
import { PieChart } from './charts/PieChart';
import { AreaChart } from './charts/AreaChart';
import { Sparkline } from './charts/Sparkline';

// Icons
import { Icons } from './icons';

/**
 * The UI object is injected into the surface sandbox as a global.
 * Surface components access it as `UI.Card`, `UI.Button`, etc.
 */
export const UI = {
  // Layout
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Separator,
  Stack,
  ScrollArea,

  // Primitives
  Button,
  Input,
  TextArea,
  Label,
  Select,
  SelectItem,
  Checkbox,
  Switch,
  Slider,

  // Navigation
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,

  // Overlay
  Dialog,
  Popover,
  Tooltip,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,

  // Data
  Badge,
  Table,
  Avatar,
  Progress,
  Skeleton,

  // Feedback
  Alert,
  toast,

  // Charts
  LineChart,
  BarChart,
  PieChart,
  AreaChart,
  Sparkline,

  // Icons
  Icons,
} as const;
