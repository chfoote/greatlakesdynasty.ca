import LegacyPlayerProfileRedirect from "./components/common/LegacyPlayerProfileRedirect";
import { lazy, Suspense, type ComponentType } from "react";

import { BrowserRouter as Router, Routes, Route } from "react-router";
import PageLoadBoundary from "./components/common/PageLoadBoundary";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AdminRoute from "./components/auth/AdminRoute";

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return function RoutedPage() {
    return <PageLoadBoundary><Suspense fallback={<div role="status" className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading page…</div>}><Page /></Suspense></PageLoadBoundary>;
  };
}
const SignIn = lazyPage(() => import("./pages/AuthPages/SignIn"));
const SignUp = lazyPage(() => import("./pages/AuthPages/SignUp"));
const NotFound = lazyPage(() => import("./pages/OtherPage/NotFound"));
const UserProfiles = lazyPage(() => import("./pages/UserProfiles"));
const Videos = lazyPage(() => import("./pages/UiElements/Videos"));
const Images = lazyPage(() => import("./pages/UiElements/Images"));
const Alerts = lazyPage(() => import("./pages/UiElements/Alerts"));
const Badges = lazyPage(() => import("./pages/UiElements/Badges"));
const Avatars = lazyPage(() => import("./pages/UiElements/Avatars"));
const Buttons = lazyPage(() => import("./pages/UiElements/Buttons"));
const LineChart = lazyPage(() => import("./pages/Charts/LineChart"));
const BarChart = lazyPage(() => import("./pages/Charts/BarChart"));
const Calendar = lazyPage(() => import("./pages/Calendar"));
const BasicTables = lazyPage(() => import("./pages/Tables/BasicTables"));
const FormElements = lazyPage(() => import("./pages/Forms/FormElements"));
const Blank = lazyPage(() => import("./pages/Blank"));
const HockeyHome = lazyPage(() => import("./pages/Dashboard/HockeyHome"));
const Standings = lazyPage(() => import("./pages/League/Standings"));
const Teams = lazyPage(() => import("./pages/League/Teams"));
const Transactions = lazyPage(() => import("./pages/League/Transactions"));
const SkaterStats = lazyPage(() => import("./pages/League/SkaterStats"));
const GoalieStats = lazyPage(() => import("./pages/League/GoalieStats"));
const PlayerProfile = lazyPage(() => import("./pages/League/PlayerProfile"));
const TeamAdmin = lazyPage(() => import("./pages/League/TeamAdmin"));
const HockeyTeamDetail = lazyPage(() => import("./pages/League/HockeyTeamDetail"));
const PlayerAdmin = lazyPage(() => import("./pages/League/PlayerAdmin"));
const PlayerChangeLog = lazyPage(() => import("./pages/League/PlayerChangeLog"));
const TradeManager = lazyPage(() => import("./pages/League/TradeManager"));
const AuctionHouse = lazyPage(() => import("./pages/League/AuctionHouse"));
const AuctionAdmin = lazyPage(() => import("./pages/League/AuctionAdmin"));
const AuctionReport = lazyPage(() => import("./pages/League/AuctionReport"));
const TradeAdmin = lazyPage(() => import("./pages/League/TradeAdmin"));
const AwardAdmin = lazyPage(() => import("./pages/League/AwardAdmin"));
const Awards = lazyPage(() => import("./pages/League/Awards"));
const LeagueDashboard = lazyPage(() => import("./pages/League/LeagueDashboard"));
const FarmSystems = lazyPage(() => import("./pages/League/FarmSystems"));
const FarmSystemRankings = lazyPage(() => import("./pages/League/FarmSystemRankings"));
const TradeMarket = lazyPage(() => import("./pages/League/TradeMarket"));
const BuyoutAdmin = lazyPage(() => import("./pages/League/BuyoutAdmin"));
const RetentionAdmin = lazyPage(() => import("./pages/League/RetentionAdmin"));
const ManagerCommandCenter = lazyPage(() => import("./pages/League/ManagerCommandCenter"));
const PowerRankings = lazyPage(() => import("./pages/League/PowerRankings"));
const GmCentre = lazyPage(() => import("./pages/League/GmCentre"));
const GmProfile = lazyPage(() => import("./pages/League/GmProfile"));
const GmTradeNetwork = lazyPage(() => import("./pages/League/GmTradeNetwork"));
const CareerEarnings = lazyPage(() => import("./pages/League/CareerEarnings"));
const RecordBook = lazyPage(() => import("./pages/League/RecordBook"));
const Rulebook = lazyPage(() => import("./pages/League/Rulebook"));
const CompetitiveBalanceDraft = lazyPage(() => import("./pages/League/CompetitiveBalanceDraft"));
const GoalHorn = lazyPage(() => import("./pages/League/GoalHorn"));
const RosterLab = lazyPage(() => import("./pages/League/RosterLab"));

export default function App() {
  return (
    <>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:abbreviation/farm-systems" element={<FarmSystems />} />
            <Route path="/farm-system-rankings" element={<FarmSystemRankings />} />
            <Route path="/teams/:abbreviation/records" element={<RecordBook />} />
            <Route path="/teams/:abbreviation" element={<HockeyTeamDetail />} />

            {/* Protected Dashboard Layout — requires login */}
            <Route element={<ProtectedRoute />}>
              <Route index path="/" element={<ManagerCommandCenter />} />
              <Route path="/league-chat" element={<HockeyHome />} />

              {/* Others Page */}
              <Route path="/profile" element={<UserProfiles />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/blank" element={<Blank />} />
              <Route path="/standings" element={<Standings />} />
              <Route path="/awards" element={<Awards />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/skater-stats" element={<SkaterStats />} />
              <Route path="/goalie-stats" element={<GoalieStats />} />
              <Route path="/batter-stats" element={<SkaterStats />} />
              <Route path="/pitcher-stats" element={<GoalieStats />} />
              <Route path="/player-profile" element={<PlayerProfile />} />
              <Route path="/player-profile/:playerId" element={<LegacyPlayerProfileRedirect />} />
              <Route path="/trade-manager" element={<TradeManager />} />
              <Route path="/roster-lab" element={<RosterLab />} />
              <Route path="/trade-market" element={<TradeMarket />} />
              <Route path="/auction-house" element={<AuctionHouse />} />
              <Route path="/league-dashboard" element={<LeagueDashboard />} />
              <Route path="/power-rankings" element={<PowerRankings />} />
              <Route path="/goal-horn" element={<GoalHorn />} />
              <Route path="/record-book" element={<RecordBook />} />
              <Route path="/contracts" element={<RecordBook />} />
              <Route path="/career-earnings" element={<CareerEarnings />} />
              <Route path="/cba" element={<Rulebook />} />
              <Route path="/competitive-balance-draft" element={<CompetitiveBalanceDraft />} />
              <Route path="/gms" element={<GmCentre />} />
              <Route path="/gm-trade-network" element={<GmTradeNetwork />} />
              <Route path="/gms/:managerId" element={<GmProfile />} />
              <Route path="/admin/trade-manager" element={<TradeManager />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin/auction-house" element={<AuctionHouse />} />
                <Route path="/admin/teams" element={<TeamAdmin />} />
                <Route path="/admin/players" element={<PlayerAdmin />} />
                <Route path="/admin/player-changes" element={<PlayerChangeLog />} />
                <Route path="/admin/trades" element={<TradeAdmin />} />
                <Route path="/admin/auction-admin" element={<AuctionAdmin />} />
                <Route path="/admin/auction-report" element={<AuctionReport />} />
                <Route path="/admin/buyouts" element={<BuyoutAdmin />} />
                <Route path="/admin/retentions" element={<RetentionAdmin />} />
                <Route path="/admin/awards" element={<AwardAdmin />} />
              </Route>

              {/* Forms */}
              <Route path="/form-elements" element={<FormElements />} />

              {/* Tables */}
              <Route path="/basic-tables" element={<BasicTables />} />

              {/* Ui Elements */}
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/avatars" element={<Avatars />} />
              <Route path="/badge" element={<Badges />} />
              <Route path="/buttons" element={<Buttons />} />
              <Route path="/images" element={<Images />} />
              <Route path="/videos" element={<Videos />} />

              {/* Charts */}
              <Route path="/line-chart" element={<LineChart />} />
              <Route path="/bar-chart" element={<BarChart />} />
            </Route>
          </Route>

          {/* Auth Layout */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </>
  );
}
