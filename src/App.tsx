import { BrowserRouter as Router, Routes, Route } from "react-router";
import SignIn from "./pages/AuthPages/SignIn";
import SignUp from "./pages/AuthPages/SignUp";
import NotFound from "./pages/OtherPage/NotFound";
import UserProfiles from "./pages/UserProfiles";
import Videos from "./pages/UiElements/Videos";
import Images from "./pages/UiElements/Images";
import Alerts from "./pages/UiElements/Alerts";
import Badges from "./pages/UiElements/Badges";
import Avatars from "./pages/UiElements/Avatars";
import Buttons from "./pages/UiElements/Buttons";
import LineChart from "./pages/Charts/LineChart";
import BarChart from "./pages/Charts/BarChart";
import Calendar from "./pages/Calendar";
import BasicTables from "./pages/Tables/BasicTables";
import FormElements from "./pages/Forms/FormElements";
import Blank from "./pages/Blank";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import HockeyHome from "./pages/Dashboard/HockeyHome";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AdminRoute from "./components/auth/AdminRoute";
import Standings from "./pages/League/Standings";
import Teams from "./pages/League/Teams";
import Transactions from "./pages/League/Transactions";
import SkaterStats from "./pages/League/SkaterStats";
import GoalieStats from "./pages/League/GoalieStats";
import PlayerProfile from "./pages/League/PlayerProfile";
import TeamAdmin from "./pages/League/TeamAdmin";
import HockeyTeamDetail from "./pages/League/HockeyTeamDetail";
import PlayerAdmin from "./pages/League/PlayerAdmin";
import TradeManager from "./pages/League/TradeManager";
import AuctionHouse from "./pages/League/AuctionHouse";
import AuctionAdmin from "./pages/League/AuctionAdmin";
import AuctionReport from "./pages/League/AuctionReport";
import TradeAdmin from "./pages/League/TradeAdmin";
import AwardAdmin from "./pages/League/AwardAdmin";
import LeagueDashboard from "./pages/League/LeagueDashboard";
import FarmSystems from "./pages/League/FarmSystems";
import TradeMarket from "./pages/League/TradeMarket";
import BuyoutAdmin from "./pages/League/BuyoutAdmin";

export default function App() {
  return (
    <>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:abbreviation/farm-systems" element={<FarmSystems />} />
            <Route path="/teams/:abbreviation" element={<HockeyTeamDetail />} />

            {/* Protected Dashboard Layout — requires login */}
            <Route element={<ProtectedRoute />}>
              <Route index path="/" element={<HockeyHome />} />

              {/* Others Page */}
              <Route path="/profile" element={<UserProfiles />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/blank" element={<Blank />} />
              <Route path="/standings" element={<Standings />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/skater-stats" element={<SkaterStats />} />
              <Route path="/goalie-stats" element={<GoalieStats />} />
              <Route path="/batter-stats" element={<SkaterStats />} />
              <Route path="/pitcher-stats" element={<GoalieStats />} />
              <Route path="/player-profile" element={<PlayerProfile />} />
              <Route path="/trade-manager" element={<TradeManager />} />
              <Route path="/trade-market" element={<TradeMarket />} />
              <Route path="/auction-house" element={<AuctionHouse />} />
              <Route path="/league-dashboard" element={<LeagueDashboard />} />
              <Route path="/admin/trade-manager" element={<TradeManager />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin/auction-house" element={<AuctionHouse />} />
                <Route path="/admin/teams" element={<TeamAdmin />} />
                <Route path="/admin/players" element={<PlayerAdmin />} />
                <Route path="/admin/trades" element={<TradeAdmin />} />
                <Route path="/admin/auction-admin" element={<AuctionAdmin />} />
                <Route path="/admin/auction-report" element={<AuctionReport />} />
                <Route path="/admin/buyouts" element={<BuyoutAdmin />} />
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
