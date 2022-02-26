// SPDX-License-Identifier: MIT

pragma solidity =0.7.6;

import "./base/FreezableToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// This contract handles swapping to and from xBRBC, Rubic's staking token.
contract RubicTokenStaking is FreezableToken, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeMath for uint256;

    uint256 constant MAX_BRBC_PER_USER = 70000000 ether; //100000;
    uint256 constant MAX_BRBC_PER_WHITELIST = 25000 ether;
    uint256 constant MIN_BRCB = 1000 ether;

    uint256 public MAX_BRBC_TOTAL = 1000000 ether;
    uint256 public whitelistPool = 700000 ether;
    uint256 public freezeTime = 1; //86400;
    uint256 public totalRBCEntered;
    uint256 public startDate = type(uint256).max;
    IERC20Minimal public immutable BRBC;

    mapping(address => uint256) public userEnteredAmount;

    EnumerableSet.AddressSet internal whitelist;

    event Entered(address staker, uint256 stakedRBC, uint256 mintedXRBC);
    event Left(address staker, uint256 burnedXRBC, uint256 givenRBC);

    // Define the BRBC token contract
    constructor(IERC20Minimal _BRBC) ERC20("Rubic Staking Token", "xBRBC") {
        BRBC = _BRBC;
        startDate = block.timestamp;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        (uint64 release, uint256 balance) = getFreezing(from, 0);
        if (release < block.timestamp && balance > 0) {
            releaseAll(from);
        }
    }

    function _enter(uint256 _amount, address _to) private {
        require(block.timestamp > startDate, "hasnt started yet");
        require(_amount >= MIN_BRCB, "too few amount");

        uint256 newEntered = userEnteredAmount[_to].add(_amount);
        uint256 newTotal = totalRBCEntered.add(_amount);

        require(newEntered <= MAX_BRBC_PER_USER, "more than limit per user");
        require(newTotal <= MAX_BRBC_TOTAL, "more than total limit");
        // Gets the amount of BRBC locked in the contract
        uint256 totalBRBC = BRBC.balanceOf(address(this));
        // Gets the amount of xBRBC in existence
        uint256 totalShares = totalSupply();

        // If no xBRBC exists, mint it 1:1 to the amount put in
        uint256 xRBCToReceive = _amount;
        if (totalShares != 0 && totalBRBC != 0) {
            // Calculate and mint the amount of xBRBC the BRBC is worth.
            // The ratio will change overtime, as xBRBC is burned/minted and
            // BRBC deposited + gained from fees / withdrawn.
            xRBCToReceive = _amount.mul(totalShares).div(totalBRBC);
        }
        mintAndFreeze(_to, xRBCToReceive, uint64(block.timestamp + freezeTime));

        // Lock the BRBC in the contract
        BRBC.transferFrom(msg.sender, address(this), _amount);

        userEnteredAmount[_to] = newEntered;
        totalRBCEntered = newTotal;

        emit Entered(_to, _amount, xRBCToReceive);
    }

    // Enter the bar. Pay some BRBCSs. Earn some shares.
    // Locks BRBC and mints xBRBC
    function enterTo(uint256 _amount, address _to) external {
        _enter(_amount, _to);
    }

    // Enter the bar. Pay some BRBCSs. Earn some shares.
    // Locks BRBC and mints xBRBC
    function enter(uint256 _amount) external {
        _enter(_amount, msg.sender);
    }

    function enterWhitelist(uint256 _amount) external {
        require(whitelist.contains(msg.sender), "you are not in whitelist");
        // if i enter for 50k RBC, i can't enter 25k additionally
        require(
            userEnteredAmount[msg.sender].add(_amount) <=
                MAX_BRBC_PER_WHITELIST,
            "more than limit per user"
        );
        require(block.timestamp < startDate + 1 days, "whitelist ended");
        _enter(_amount, msg.sender);
    }

    // Claim back your BRBCs.
    // Unlocks the staked + gained BRBC and burns xBRBC
    function leave(uint256 xRBCAmount) external {
        // Gets the amount of xBRBC in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of BRBC the xBRBC is worth
        uint256 BRBCToReceive = xRBCAmount
            .mul(BRBC.balanceOf(address(this)))
            .div(totalShares);
        _burn(msg.sender, xRBCAmount);
        BRBC.transfer(msg.sender, BRBCToReceive);
        MAX_BRBC_TOTAL = MAX_BRBC_TOTAL.add(BRBCToReceive);
        emit Left(msg.sender, xRBCAmount, BRBCToReceive);
    }

    function canReceive(uint256 _amount) external view returns (uint256) {
        uint256 totalShares = totalSupply();
        require(
            _amount <= totalShares,
            "amount is greater than total xBRCB amount"
        );
        return _amount.mul(BRBC.balanceOf(address(this))).div(totalShares);
    }

    function setFreezeTime(uint256 _freezeTime) external onlyOwner {
        require(_freezeTime <= 86400, "freezeTime is to big");
        freezeTime = _freezeTime;
    }

    function setWhitelist(address[] memory whitelistedAddresses)
        external
        onlyOwner
    {
        for (uint256 i = 0; i < whitelistedAddresses.length; i++) {
            whitelist.add(whitelistedAddresses[i]);
        }
    }

    function endWhitelist() external onlyOwner {
        require(block.timestamp > startDate + 1 seconds, "whitelist not ended");
        MAX_BRBC_TOTAL = MAX_BRBC_TOTAL.add(whitelistPool);
        whitelistPool = 0;
    }

    function setStartDate(uint256 _startDate) external onlyOwner {
        require(block.timestamp < _startDate);
        startDate = _startDate;
    }

    function sweepTokens(IERC20Minimal token) external onlyOwner {
        require(token != BRBC, "cant sweep BRBC");
        token.transfer(msg.sender, token.balanceOf(address(this)));
    }
}
