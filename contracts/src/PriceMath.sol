// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Opening sqrt price for a single-sided Instant mint. Same ratio the Arc factory used
///         via BondingCurveDexSeed, without bringing the curve contract along.
library PriceMath {
    function sqrtPriceX96(bool launchIsToken0, uint256 vQuote, uint256 vToken) internal pure returns (uint160) {
        (uint256 num, uint256 den) = launchIsToken0 ? (vQuote, vToken) : (vToken, vQuote);
        uint256 ratioX192 = Math.mulDiv(num, uint256(1) << 192, den);
        uint256 s = Math.sqrt(ratioX192);
        require(s <= type(uint160).max);
        return uint160(s);
    }
}
